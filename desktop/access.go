package desktop

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"
)

// Access decides who may use the deck: the phones you paired, and the agents'
// hook. It mirrors the Mac app's Access and Phones.
//
// Each phone has a key of its own, handed over once when it pairs. To pair,
// you ask for a code; the phone opens the deck's address and enters it, or
// scans it, and gets a new key in return. A code exists only after you ask
// for one, lasts five minutes and works once. Five wrong tries lock out the
// address they came from until the next code, and twenty in all withdraw the
// code.
//
// The hook has a separate key, in a file only you can read. It opens /hook,
// from this computer, and nothing else; no phone's key opens /hook.
type Access struct {
	Phones  *Phones
	HookKey string

	code        string
	codeExpiry  time.Time
	misses      map[string]int // wrong codes since the current one, by address
	totalMisses int
}

const (
	codeLifetime = 5 * time.Minute
	// Wrong codes one address may try before it is locked out.
	maxAttemptsPerAddress = 5
	// Wrong codes from everywhere before the code is withdrawn: the backstop
	// for a device that keeps changing its address.
	maxAttempts = 20
)

func NewAccess() *Access {
	return &Access{Phones: loadPhones(), HookKey: loadHookKey(), misses: map[string]int{}}
}

func (a *Access) IsHookKey(candidate string) bool {
	return candidate != "" && constantTimeEqual(candidate, a.HookKey)
}

// NewCode replaces any earlier code and lifts lockouts.
func (a *Access) NewCode() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
	a.code = fmt.Sprintf("%06d", n.Int64())
	a.codeExpiry = time.Now().Add(codeLifetime)
	a.misses = map[string]int{}
	a.totalMisses = 0
	return a.code
}

// ActiveCode is the current code, or "" if none was asked for or it ran out.
func (a *Access) ActiveCode() string {
	if a.code == "" || time.Now().After(a.codeExpiry) {
		return ""
	}
	return a.code
}

func (a *Access) CodeExpiresIn() time.Duration { return time.Until(a.codeExpiry) }

// Redeem returns a key for a newly paired phone if attempt is the active
// code and address isn't locked out. The code is spent on success.
func (a *Access) Redeem(attempt, address, userAgent string) (string, bool) {
	active := a.ActiveCode()
	if active == "" || a.misses[address] >= maxAttemptsPerAddress {
		return "", false
	}
	if constantTimeEqual(attempt, active) {
		a.code = ""
		return a.Phones.Pair(phoneName(userAgent)), true
	}
	a.misses[address]++
	a.totalMisses++
	if a.totalMisses >= maxAttempts {
		a.code = ""
	}
	return "", false
}

func loadHookKey() string {
	if saved, err := os.ReadFile(hookKeyFile); err == nil {
		if key := strings.TrimSpace(string(saved)); key != "" {
			return key
		}
	}
	key := randomKey()
	_ = writePrivate(hookKeyFile, []byte(key+"\n"))
	return key
}

// PairedPhone is a phone you paired, as phones.json keeps it.
type PairedPhone struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	PairedAt time.Time `json:"pairedAt"`
	LastSeen time.Time `json:"lastSeen"`
	// SHA-256 of the phone's key, in hex. The key itself is never stored.
	KeyHash string `json:"keyHash"`
}

// Phones is every paired phone. Each has its own key, so one can be revoked
// and the others keep working. This computer keeps only a hash of each key,
// so the file can't be used to pose as a phone.
type Phones struct {
	All []PairedPhone
}

// How out of date LastSeen may get before a request updates it. Saving on
// every request would rewrite the file many times a second.
const seenResolution = time.Minute

func loadPhones() *Phones {
	phones := &Phones{}
	if data, err := os.ReadFile(phonesFile); err == nil {
		_ = json.Unmarshal(data, &phones.All)
	}
	return phones
}

// Pair adds a phone and returns its key: the only time the key exists here.
func (p *Phones) Pair(name string) string {
	key := randomKey()
	now := time.Now().UTC().Truncate(time.Second)
	p.All = append(p.All, PairedPhone{ID: newID(), Name: name, PairedAt: now, LastSeen: now, KeyHash: hashKey(key)})
	p.save()
	return key
}

// WithKey is the phone holding key, if any.
func (p *Phones) WithKey(key string) *PairedPhone {
	if key == "" {
		return nil
	}
	hash := hashKey(key)
	for i := range p.All {
		if constantTimeEqual(p.All[i].KeyHash, hash) {
			return &p.All[i]
		}
	}
	return nil
}

func (p *Phones) MarkSeen(phone *PairedPhone) {
	if time.Since(phone.LastSeen) < seenResolution {
		return
	}
	phone.LastSeen = time.Now().UTC().Truncate(time.Second)
	p.save()
}

func (p *Phones) Remove(id string) {
	kept := p.All[:0]
	for _, phone := range p.All {
		if phone.ID != id {
			kept = append(kept, phone)
		}
	}
	p.All = kept
	p.save()
}

func (p *Phones) RemoveAll() {
	p.All = nil
	p.save()
}

func (p *Phones) save() {
	data, err := json.MarshalIndent(p.orEmpty(), "", "  ")
	if err == nil {
		_ = writePrivate(phonesFile, data)
	}
}

func (p *Phones) orEmpty() []PairedPhone {
	if p.All == nil {
		return []PairedPhone{}
	}
	return p.All
}

// phoneName is what the setup page calls a phone. The User-Agent is all
// there is to go on, and a broad name is all it can honestly give.
func phoneName(userAgent string) string {
	switch {
	case strings.Contains(userAgent, "iPhone"):
		return "iPhone"
	case strings.Contains(userAgent, "iPad"):
		return "iPad"
	case strings.Contains(userAgent, "Android"):
		return "Android phone"
	}
	return "Phone"
}

func hashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// randomKey is 32 random bytes, base64url-encoded so they travel in a URL
// unescaped.
func randomKey() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		panic("no secure random source available")
	}
	return base64.RawURLEncoding.EncodeToString(bytes)
}

func newID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return strings.ToUpper(hex.EncodeToString(bytes))
}

// constantTimeEqual compares without stopping at the first difference, so
// response timing says nothing about how much of a guess was right.
func constantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
