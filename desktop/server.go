package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	agentdeck "github.com/Sauzze/agentdeck"
	"rsc.io/qr"
)

// The HTTP side, as the Mac app's HTTPServer.swift and DeckRouter.swift:
//
//   - The phone's pages and API need a paired phone's key, sent as ?t= (the
//     page's own URL, so a home-screen bookmark keeps it) or as
//     X-AgentDeck-Token. They must also be addressed to an IP address or a
//     local name, which keeps out web pages using DNS rebinding.
//   - /hook and /launcher need the hook's own key, and answer only to this
//     computer.
//   - Pairing is open, but useless without a code you asked for here.
//   - The setup page has no key, so it answers only to this computer, and its
//     actions need a header that other sites can't send without asking first.

const (
	// Far more than a few phones, launchers and hooks ever open at once.
	// Beyond it, new connections are refused, so a flood can't exhaust the app.
	maxConnections = 64
	// Longer than any real request takes to arrive.
	requestTimeout = 10 * time.Second
	maxRequestSize = 1 << 20
	// Sent by the setup page with every action. A custom header makes the
	// browser ask permission first for any cross-site request, which this
	// server never grants.
	setupHeader = "X-AgentDeck-Setup"
)

// Serve listens on the deck's port until it fails.
func Serve(deck *Deck) error {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", Port))
	if err != nil {
		return err
	}
	server := &http.Server{
		Handler:           &router{deck: deck},
		ReadHeaderTimeout: requestTimeout,
		MaxHeaderBytes:    maxRequestSize,
	}
	return server.Serve(&cappedListener{Listener: listener, slots: make(chan struct{}, maxConnections)})
}

// cappedListener refuses connections beyond its slots rather than queueing
// them.
type cappedListener struct {
	net.Listener
	slots chan struct{}
}

func (l *cappedListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		select {
		case l.slots <- struct{}{}:
			return &slotConn{Conn: conn, release: func() { <-l.slots }}, nil
		default:
			conn.Close()
		}
	}
}

type slotConn struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *slotConn) Close() error {
	c.once.Do(c.release)
	return c.Conn.Close()
}

type router struct {
	deck *Deck
}

// request is what the router needs to know about one.
type request struct {
	*http.Request
	isLocal             bool // sent from this computer to a local name
	isAddressedDirectly bool // to an IP address or a local name, as a phone would
	remoteAddress       string
}

var (
	portSuffix  = regexp.MustCompile(`:\d+$`)
	ipv4Address = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}$`)
)

func (rt *router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestSize)
	host := portSuffix.ReplaceAllString(r.Host, "")
	remote, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(remote)
	req := &request{
		Request:             r,
		isLocal:             ip != nil && ip.IsLoopback() && (host == "localhost" || host == "127.0.0.1" || host == "[::1]"),
		isAddressedDirectly: host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasPrefix(host, "[") || ipv4Address.MatchString(host),
		remoteAddress:       remote,
	}
	w.Header().Set("Cache-Control", "no-store")
	rt.handle(w, req)
}

func (rt *router) handle(w http.ResponseWriter, r *request) {
	d := rt.deck
	switch {
	// Fetched by the phone itself for the home-screen icon, with no key to send.
	case r.URL.Path == "/icon.png":
		d.mu.Lock()
		logo := d.config.Logo
		d.mu.Unlock()
		serveFile(w, "Resources/web/icon-"+logo+".png")
		return
	case r.URL.Path == "/setup" || strings.HasPrefix(r.URL.Path, "/setup/"):
		if !r.isLocal {
			http.NotFound(w, r.Request)
			return
		}
		if r.Method != http.MethodGet && r.Header.Get(setupHeader) != "1" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		rt.setup(w, r)
		return
	case r.URL.Path == "/hook":
		if !r.isLocal || r.Method != http.MethodPost {
			http.NotFound(w, r.Request)
			return
		}
		if !d.isHookKey(r.Header.Get(hookKeyHeader)) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		at, err := strconv.ParseFloat(r.Header.Get("X-AgentDeck-At"), 64)
		if err != nil {
			at = nowMillis()
		}
		d.Ingest(decodeJSON(r.Body), r.Header.Get("X-AgentDeck-Agent"), r.Header.Get("X-AgentDeck-Tab"), at)
		w.WriteHeader(http.StatusNoContent)
		return
	case r.URL.Path == "/launcher":
		if !r.isLocal || r.Method != http.MethodGet {
			http.NotFound(w, r.Request)
			return
		}
		if !d.isHookKey(r.Header.Get(hookKeyHeader)) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		rt.launcher(w, r)
		return
	}

	if !r.isAddressedDirectly {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	if r.Method == http.MethodPost && r.URL.Path == "/pair" {
		code := strings.Map(func(c rune) rune {
			if c >= '0' && c <= '9' {
				return c
			}
			return -1
		}, stringValue(decodeJSON(r.Body)["code"]))
		d.mu.Lock()
		key, ok := d.access.Redeem(code, r.remoteAddress, r.UserAgent())
		d.mu.Unlock()
		if !ok {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "That code isn't valid. Get a new one on your computer."})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"key": key})
		return
	}

	key := r.URL.Query().Get("t")
	if key == "" {
		key = r.Header.Get(hookKeyHeader)
	}
	d.mu.Lock()
	phone := d.access.Phones.WithKey(key)
	phoneID := ""
	if phone != nil {
		d.access.Phones.MarkSeen(phone)
		phoneID = phone.ID
	}
	d.mu.Unlock()

	if r.Method == http.MethodGet && r.URL.Path == "/" {
		page := "deck.html"
		if phoneID == "" {
			page = "pair.html"
		}
		serveFile(w, "Resources/web/"+page)
		return
	}
	if phoneID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	session := r.URL.Query().Get("session")
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/events":
		rt.events(w, r, phoneID)
	case r.Method == http.MethodPost && r.URL.Path == "/focus":
		writeStatus(w)(d.Focus(session))
	case r.Method == http.MethodPost && r.URL.Path == "/act":
		writeStatus(w)(d.Perform(r.URL.Query().Get("action"), session, r.URL.Query()))
	default:
		http.NotFound(w, r.Request)
	}
}

func (d *Deck) isHookKey(candidate string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.access.IsHookKey(candidate)
}

// MARK: Server-Sent Events

// eventStream pushes the deck's state to one phone as it changes.
type eventStream struct {
	messages chan []byte // nil is a ping
	closed   chan struct{}
	once     sync.Once
}

func newEventStream() *eventStream {
	return &eventStream{messages: make(chan []byte, 8), closed: make(chan struct{})}
}

// send never waits: a phone that isn't reading misses a message, and the
// next carries the whole state anyway.
func (s *eventStream) send(state []byte) {
	select {
	case s.messages <- state:
	default:
	}
}

// close hangs up. The phone's next attempt to reconnect is answered afresh.
func (s *eventStream) close() { s.once.Do(func() { close(s.closed) }) }

func (rt *router) events(w http.ResponseWriter, r *request, phone string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	stream := rt.deck.attach(phone)
	defer rt.deck.detach(stream)
	w.Header().Set("Content-Type", "text/event-stream")
	// Hanging up ends the connection, not just this response, as on the Mac.
	w.Header().Set("Connection", "close")
	w.WriteHeader(http.StatusOK)
	for {
		select {
		case state := <-stream.messages:
			if state == nil {
				// A comment line, so Safari and anything in between keep an
				// idle stream open.
				_, _ = io.WriteString(w, ": ping\n\n")
			} else {
				_, _ = fmt.Fprintf(w, "data: %s\n\n", state)
			}
			flusher.Flush()
		case <-stream.closed:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// launcher keeps a launcher's connection open and sends it the deck's keys.
func (rt *router) launcher(w http.ResponseWriter, r *request) {
	flusher, ok := w.(http.Flusher)
	query := r.URL.Query()
	id := query.Get("id")
	if !ok || id == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	tab := rt.deck.launcherConnected(id, Agent(query.Get("agent")), query.Get("folder"))
	defer rt.deck.launcherGone(id, tab)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	encoder := json.NewEncoder(w)
	for {
		select {
		case command := <-tab.commands:
			if encoder.Encode(command) != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// MARK: Setup page

func (rt *router) setup(w http.ResponseWriter, r *request) {
	d := rt.deck
	query := r.URL.Query()
	path := r.URL.Path
	d.mu.Lock()
	config := d.config
	d.mu.Unlock()

	switch {
	case r.Method == http.MethodGet && path == "/setup":
		d.mu.Lock()
		if !config.HasCompletedSetup {
			config.HasCompletedSetup = true
			config.save()
		}
		d.mu.Unlock()
		serveFile(w, "Resources/web/setup.html")

	case r.Method == http.MethodGet && path == "/setup/state":
		writeJSON(w, http.StatusOK, rt.setupState())

	// The deck, for the preview beside the layout editor: the one page a
	// frame may show, and only one of this deck's own.
	case r.Method == http.MethodGet && path == "/setup/preview":
		serveFramedBy(w, "Resources/web/deck.html", "SAMEORIGIN", "'self'")

	case r.Method == http.MethodPost && path == "/setup/layout":
		data, _ := io.ReadAll(r.Body)
		layout, err := parseLayout(data)
		if err != nil {
			writeStatus(w)(http.StatusBadRequest, err.Error())
			return
		}
		d.mu.Lock()
		config.Layout = layout
		config.save()
		d.changed()
		d.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)

	case r.Method == http.MethodPost && path == "/setup/profiles":
		rt.profiles(w, r)

	case r.Method == http.MethodGet && path == "/setup/qr.png":
		d.mu.Lock()
		code := d.access.ActiveCode()
		d.mu.Unlock()
		if code == "" {
			http.NotFound(w, r.Request)
			return
		}
		image, err := qr.Encode(pairingLink(code), qr.M)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		image.Scale = 8
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(image.PNG())

	case r.Method == http.MethodGet && strings.HasPrefix(path, "/setup/logo/"):
		logo := strings.TrimPrefix(path, "/setup/logo/")
		if !contains(logos, logo) {
			http.NotFound(w, r.Request)
			return
		}
		serveFile(w, "Resources/web/icon-"+logo+".png")

	case r.Method == http.MethodPost && path == "/setup/pair":
		d.mu.Lock()
		d.access.NewCode()
		d.mu.Unlock()
		writeJSON(w, http.StatusOK, rt.setupState())

	case r.Method == http.MethodPost && path == "/setup/unpair":
		id := query.Get("phone")
		if query.Get("all") != "1" && id == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		d.mu.Lock()
		d.unpair(id)
		d.mu.Unlock()
		writeJSON(w, http.StatusOK, rt.setupState())

	case r.Method == http.MethodPost && (path == "/setup/pin" || path == "/setup/unpin"):
		index, err := strconv.Atoi(query.Get("key"))
		if err != nil || index < 0 || index >= mostKeys {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		d.mu.Lock()
		if path == "/setup/unpin" {
			config.Unpin(index)
		} else if folder := query.Get("folder"); folder != "" {
			config.Pin(folder, index)
		} else {
			d.mu.Unlock()
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		d.changed()
		d.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)

	case r.Method == http.MethodPost && path == "/setup/theme":
		d.mu.Lock()
		config.Colours = customisations(decodeJSON(r.Body))
		config.save()
		d.changed()
		d.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)

	case r.Method == http.MethodPost && path == "/setup/logo":
		logo := query.Get("logo")
		if !contains(logos, logo) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		d.mu.Lock()
		config.Logo = logo
		config.save()
		d.changed()
		d.mu.Unlock()
		writeJSON(w, http.StatusOK, rt.setupState())

	case r.Method == http.MethodPost && path == "/setup/scroll":
		d.mu.Lock()
		config.ScrollEnabled = query.Get("enabled") == "1"
		config.save()
		d.changed()
		d.mu.Unlock()
		writeJSON(w, http.StatusOK, rt.setupState())

	case r.Method == http.MethodPost && path == "/setup/hooks":
		var err error
		if query.Get("remove") == "" {
			err = connectAgents()
		} else {
			err = disconnectAgents()
		}
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, rt.setupState())

	case r.Method == http.MethodPost && path == "/setup/login":
		setOpenAtLogin(query.Get("enabled") == "1")
		writeJSON(w, http.StatusOK, rt.setupState())

	default:
		http.NotFound(w, r.Request)
	}
}

// profiles switches to, saves, renames, deletes or imports a profile, and
// answers with the setup state.
func (rt *router) profiles(w http.ResponseWriter, r *request) {
	d := rt.deck
	query := r.URL.Query()
	name := query.Get("name")
	// What a file's profile would be, without adding it.
	if query.Get("action") == "check" {
		data, _ := io.ReadAll(r.Body)
		profile, err := checkedProfile(data)
		// No room is said up front, not after the warning.
		d.mu.Lock()
		if len(d.config.Profiles) >= mostProfiles {
			err = errTooMany
		}
		d.mu.Unlock()
		if err != nil {
			writeStatus(w)(http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, profile)
		return
	}
	d.mu.Lock()
	var err error
	switch query.Get("action") {
	case "switch":
		err = d.config.SwitchProfile(name)
	case "save":
		err = d.config.SaveProfile(name)
	case "rename":
		err = d.config.RenameProfile(name, query.Get("to"))
	case "delete":
		d.config.DeleteProfile(name)
	case "import":
		data, _ := io.ReadAll(r.Body)
		err = d.config.ImportProfile(data)
	default:
		err = errors.New("Unknown action.")
	}
	if err == nil {
		d.changed()
	}
	d.mu.Unlock()
	if err != nil {
		writeStatus(w)(http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rt.setupState())
}

func (rt *router) setupState() map[string]any {
	d := rt.deck
	found := foundAgents()
	agentList := make([]map[string]any, len(found))
	for i, agent := range found {
		agentList[i] = map[string]any{"id": agent, "name": agent.Name(), "connected": isConnected(agent)}
	}
	connected := allConnected()
	openAtLogin := isOpenAtLogin()

	d.mu.Lock()
	defer d.mu.Unlock()
	keys, _ := d.layout()
	keyOf := map[string]int{}
	for i, key := range keys {
		if key.session != nil {
			keyOf[key.session.ID] = i
		}
	}
	pairing := map[string]any{"address": phoneAddress(), "codeExpiresIn": 0}
	if code := d.access.ActiveCode(); code != "" {
		pairing["code"] = code
		pairing["codeExpiresIn"] = int(d.access.CodeExpiresIn().Seconds())
	}
	phones := make([]map[string]any, len(d.access.Phones.All))
	for i, phone := range d.access.Phones.All {
		phones[i] = map[string]any{
			"id": phone.ID, "name": phone.Name,
			"pairedAt": phone.PairedAt.UnixMilli(), "lastSeen": phone.LastSeen.UnixMilli(),
			"connected": d.isConnected(phone.ID),
		}
	}
	// Every key a project can be pinned to, even those the phone doesn't
	// show: with Auto, a pin there adds keys up to it; with a fixed number,
	// a pin left beyond them can still be undone.
	pins := make([]any, mostKeys)
	for i, pin := range d.config.Pins[:mostKeys] {
		if pin != nil {
			pins[i] = map[string]any{"folder": *pin, "name": lastPathComponent(*pin)}
		}
	}
	sessions := []map[string]any{}
	for _, s := range d.sessions.All() {
		var key any
		if index, ok := keyOf[s.ID]; ok {
			key = index
		}
		sessions = append(sessions, map[string]any{
			"id": s.ID, "folder": s.Folder, "name": s.Name(), "agentName": s.Agent.Name(),
			"state": s.State, "key": key,
		})
	}
	return map[string]any{
		// No accessibility step: nothing here needs that permission.
		"checklist": map[string]any{"hooks": connected, "scroll": d.config.ScrollEnabled, "openAtLogin": openAtLogin},
		"agents":    agentList,
		// What to type to start an agent through the launcher.
		"launcher": launchCommand(),
		"pairing":  pairing,
		"phones":   phones,
		"logo":     d.config.Logo,
		"pins":     pins,
		// How many keys the phone shows now.
		"phoneKeys": len(keys),
		"sessions":  sessions,
		"theme":     themeEditor(d.config),
		"layout":    d.config.Layout,
		// Saved looks, besides Default, the one the deck was last switched
		// to, and whether it has changed since.
		// A copy: the reply is written after the lock is let go.
		"profiles":      slices.Clone(d.config.Profiles),
		"activeProfile": d.config.ActiveProfile,
		"profileEdited": d.config.profileEdited(),
	}
}

// MARK: Helpers

// serveFile serves a page no other page may show in a frame, where it could
// lay something over it and trick you into pressing a button.
func serveFile(w http.ResponseWriter, name string) {
	serveFramedBy(w, name, "DENY", "'none'")
}

// serveFramedBy serves a page with who may frame it, as X-Frame-Options and
// as the Content-Security-Policy's frame-ancestors.
func serveFramedBy(w http.ResponseWriter, name, frameOptions, frameAncestors string) {
	data, err := fs.ReadFile(agentdeck.Files, name)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if strings.HasSuffix(name, ".png") {
		w.Header().Set("Content-Type", "image/png")
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Frame-Options", frameOptions)
		w.Header().Set("Content-Security-Policy", "frame-ancestors "+frameAncestors)
	}
	_, _ = w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// writeStatus answers with a status and, unless it's empty, a message the
// phone shows.
func writeStatus(w http.ResponseWriter) func(int, string) {
	return func(status int, message string) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, message)
	}
}

func decodeJSON(body io.Reader) map[string]any {
	value := map[string]any{}
	_ = json.NewDecoder(body).Decode(&value)
	return value
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
