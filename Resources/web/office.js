/*
 * The Agent Office: the deck's sessions as people in a little pixel-art
 * office, for the phone's Office view and the /office page.
 *
 * Each key is a desk, in the same order, with a person at it who acts out
 * what their session is doing. Everything is drawn in code on a 320 × 180
 * grid of art pixels, scaled by a whole number of the screen's pixels so
 * every edge stays sharp.
 *
 *   AgentOffice.create(canvas, on) → { show(snapshot), close(), select(id), setVisible(shown), setFramed(framed), moved() }
 *
 * `show` takes what the deck streams; `close` empties the office when the
 * stream drops, and whoever is there when it's back is already at work.
 * `select` marks the session the deck's controls act on. `setFramed` puts
 * the room behind a window with rounded corners, as the phone shows it
 * beside its controls. `moved` says the canvas is now in another window,
 * such as one kept on top of the others, or back on its page: the room
 * goes on there, sized for that window.
 *
 * The room can be tapped, and says what was tapped through `on`, for the
 * page to do what its keys and buttons would: `on.select(id)` for a desk or
 * its person, `on.max()` for the nuclear button, `on.mic('down' | 'up')` for
 * the microphone, held, and `on.hint(text)` for a word on the status line.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------ the floor */

  // The room is 16:9, like a screen. Desks fill the left in three rows of
  // three, one for each key in reading order; a corridor runs down from the
  // door between them and the lounge on the right.
  const WIDTH = 320, HEIGHT = 180;
  const WALL_BOTTOM = 40;   // where the back wall meets the floor
  const LOUNGE_LEFT = 224;  // the lounge's carpet starts here
  const CORRIDOR_X = 214;
  const DOOR = { x: CORRIDOR_X, y: 37 }; // just inside the doorway
  const DESK_WIDTH = 44;
  const DESK_COLUMNS = [22, 88, 154];
  const DESK_ROWS = [58, 102, 146];
  /** The top-left corner of each desk's surface. */
  const DESKS = DESK_ROWS.flatMap((y) => DESK_COLUMNS.map((x) => ({ x, y })));

  /** Where the person at a desk sits, feet hidden behind it. */
  const seat = (desk) => ({ x: DESKS[desk].x + 28, y: DESKS[desk].y + 4 });
  /** The walkway behind each row of desks. */
  const lane = (desk) => DESKS[desk].y - 5;
  const laneNearest = (y) => DESK_ROWS.map((row) => row - 5).reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));

  /** Where idle people spend their time in the lounge, whatever its corner holds. */
  const LOUNGE_SPOTS = [
    { x: 243, y: 50, pose: 'away' },  // the coffee machine
    { x: 274, y: 47, pose: 'away' },  // the window
    { x: 297, y: 55, pose: 'stand' }, // the water cooler
    { x: 258, y: 116, pose: 'sit' },  // the couch
    { x: 276, y: 116, pose: 'sit' },
    { x: 294, y: 116, pose: 'sit' },
    { x: 238, y: 158, pose: 'stand' }, // ping-pong
    { x: 298, y: 158, pose: 'stand' },
  ];
  const PING_PONG = [6, 7];

  // The nuclear button stands at the foot of the corridor, clear of every
  // route. Its presser stands to its left and reaches across onto the dome;
  // anyone else waits on the other side.
  const BUTTON = { x: CORRIDOR_X, y: 161 };
  const PRESSER = { x: CORRIDOR_X - 9, y: 163 };
  const NEXT_IN_LINE = { x: CORRIDOR_X + 12, y: 163 };

  /** The microphone on its stand, in the lounge's bottom-right corner: where its base meets the floor. */
  const MIC = { x: 311, y: 176 };
  /** The plant, moved to the lounge's bottom-left to make room for it: its leaves' left edge. */
  const PLANT_X = 226;

  /**
   * How the office is furnished, as set up on the setup page: the layout's
   * `room`. Each part's choices, the first being what an office has when the
   * layout says nothing. The apps' Layout.swift and layout.go keep the same.
   */
  const ROOM_CHOICES = {
    mic: ['mic', 'megaphone'],
    floor: ['wood', 'tiles', 'concrete', 'carpet'],
    paint: ['slate', 'sage', 'clay', 'cream'],
    lounge: ['navy', 'teal', 'plum', 'sand'],
    corner: ['arcade', 'vending', 'foosball', 'fishtank', 'books', 'none'],
    sky: ['live', 'day'],
  };
  /** What each of the back wall's five places can hold, and what it holds unless set up otherwise. */
  const WALL_CHOICES = ['window', 'whiteboard', 'pinboard', 'poster', 'shelf', 'plant', 'bare'];
  const STANDARD_WALL = ['window', 'whiteboard', 'window', 'pinboard', 'window'];
  /** The middle of each of the back wall's places, left to right. */
  const WALL_SLOTS = [44, 77, 110, 143, 176];

  /** A room as the layout gives it: anything unknown or left out is as standard. */
  function roomOf(given) {
    const raw = given && typeof given === 'object' ? given : {};
    const room = {};
    for (const [part, choices] of Object.entries(ROOM_CHOICES)) room[part] = choices.includes(raw[part]) ? raw[part] : choices[0];
    room.wall = STANDARD_WALL.map((standard, i) => (Array.isArray(raw.wall) && WALL_CHOICES.includes(raw.wall[i]) ? raw.wall[i] : standard));
    return room;
  }

  /** Where idle people go round the lounge's corner piece: to play, to buy a snack, to watch the fish. */
  const CORNER_SPOTS = {
    arcade: [{ x: 272, y: 93, pose: 'away' }],
    vending: [{ x: 272, y: 93, pose: 'away' }],
    foosball: [{ x: 272, y: 76, pose: 'stand' }, { x: 272, y: 97, pose: 'away' }],
    fishtank: [{ x: 272, y: 93, pose: 'away' }],
    books: [{ x: 274, y: 94, pose: 'sit' }],
    none: [],
  };

  /** In front of the first whiteboard on the back wall, if there is one: where a to-do list gets written up. */
  function boardSpotsOf(room) {
    const slot = room.wall.indexOf('whiteboard');
    return slot < 0 ? [] : [{ x: WALL_SLOTS[slot] - 5, y: 44 }, { x: WALL_SLOTS[slot] + 6, y: 44 }];
  }

  // The office as it's furnished now. There is one to a page, so the
  // drawing and the people's comings and goings read it from here.
  let decor = roomOf(null);
  let spots = [...LOUNGE_SPOTS, ...CORNER_SPOTS[decor.corner]];
  let boardSpots = boardSpotsOf(decor);
  /** Under the clock by the door, where a rate-limited agent waits. */
  const CLOCK_SPOTS = [{ x: 202, y: 47 }, { x: 193, y: 47 }, { x: 184, y: 47 }];
  /** Where a desk's subagents stand round it: two on each side. */
  const INTERN_SLOTS = [{ dx: -6, dy: 4 }, { dx: DESK_WIDTH + 5, dy: 4 }, { dx: -6, dy: 15 }, { dx: DESK_WIDTH + 5, dy: 15 }];
  /** The shredder beside a desk, on the floor to its right, and where its feeder stands. */
  const SHREDDER = { dx: DESK_WIDTH + 2 };
  const SHREDDING = { dx: DESK_WIDTH + 13, dy: 15 };

  // Where a person is, or is heading: 'desk:n', 'spot:n', 'door', 'button',
  // 'queue' (the spot beside it), 'board:n', 'clock:n', 'shred:desk', or for
  // a subagent, 'near:desk:slot'.
  const deskPlace = (desk) => `desk:${desk}`;
  const spotPlace = (spot) => `spot:${spot}`;
  const numberAfter = (prefix, place) => (place.startsWith(prefix) ? Number(place.split(':')[1]) : null);
  const deskOf = (place) => numberAfter('desk:', place);
  const spotOf = (place) => numberAfter('spot:', place);

  function pointOf(place) {
    const [kind, a, b] = place.split(':');
    const desk = DESKS[Number(a)];
    switch (kind) {
      case 'desk': return seat(Number(a));
      case 'spot': return spots[Number(a)];
      case 'board': return boardSpots[Number(a)];
      case 'clock': return CLOCK_SPOTS[Number(a)];
      case 'shred': return { x: desk.x + SHREDDING.dx, y: desk.y + SHREDDING.dy };
      case 'near': return { x: desk.x + INTERN_SLOTS[Number(b)].dx, y: desk.y + INTERN_SLOTS[Number(b)].dy };
      default: return { door: DOOR, button: PRESSER, queue: NEXT_IN_LINE }[place];
    }
  }

  /** The walkway a place is reached by: a desk's own row, or the first row's for the back wall. */
  function laneTo(place) {
    const [kind, a] = place.split(':');
    if (kind === 'desk' || kind === 'shred' || kind === 'near') return lane(Number(a));
    if (kind === 'board' || kind === 'clock') return lane(0);
    return null;
  }

  /**
   * The way from where someone stands to a place. Desks, and what's round
   * them or on the back wall, are reached along the walkway behind their
   * row, from the corridor; the lounge is open floor, crossed in a straight
   * line.
   */
  function route(from, place) {
    const target = pointOf(place);
    const walkway = laneTo(place);
    const amongDesks = from.x < CORRIDOR_X - 1 && from.y > WALL_BOTTOM;
    const current = laneNearest(from.y);
    const path = [];
    if (walkway !== null && amongDesks && walkway === current) {
      path.push({ x: from.x, y: current });
    } else {
      if (amongDesks) path.push({ x: from.x, y: current }, { x: CORRIDOR_X, y: current });
      if (walkway !== null) path.push({ x: CORRIDOR_X, y: walkway });
      else if (place === 'door') path.push({ x: CORRIDOR_X, y: WALL_BOTTOM + 8 });
    }
    if (walkway !== null) path.push({ x: target.x, y: walkway });
    path.push({ x: target.x, y: target.y });
    return path.filter((p) => p.x !== from.x || p.y !== from.y);
  }

  /* ---------------------------------------------------------- the palette */

  const PALETTE = {
    wall: 0x2f3446, wallTop: 0x252a3a, loungeWall: 0x353447, wainscot: 0x272b3b, rail: 0x3d4359,
    baseboard: 0x1b1e2a, frame: 0x1b1e2a, sill: 0x8a90a6,
    wood: 0x6f5440, plankSeam: 0x624a38, carpet: 0x3f4a5c, carpetEdge: 0x353e4e, rug: 0x3f6b6b, rugEdge: 0x4f8080,
    deskEdge: 0xdcb78c, deskTop: 0xc49a6c, deskFront: 0x8c6744, deskLip: 0x76573a, drawer: 0x9b7550, handle: 0x3a2a1c,
    monitor: 0x262a35, monitorPanel: 0x2f3442, monitorStand: 0x3d4250, monitorOn: 0x4a5266,
    keyboard: 0x4a5060, keys: 0x5f6678, chair: 0x2f5560, chairTop: 0x3f7080,
    paper: 0xeae6dc, mug: 0xf1ede4, leaf: 0x4f9a5a, leafDark: 0x3b7a46, pot: 0xa0603e,
    door: 0x6b4e37, doorPanel: 0x5c422e, doorway: 0x0d0f14, brass: 0xd6b25e, mat: 0x7a3b3b,
    whiteboard: 0xe9edf2, cork: 0xb08a5a,
    counterTop: 0xc9c3b8, counter: 0x6b4e37, machine: 0x2a2a2e, water: 0x8fc6f0, cooler: 0xe2e2e2,
    couch: 0x7a4a5a, couchLight: 0x8c5868, couchDark: 0x633a49, table: 0x2f7a5b, tableLine: 0xe6efe9, tableLeg: 0x23272f,
    pants: 0x2e3550, shoes: 0x1a1a1f, eye: 0x1f1a1a, bubble: 0xf4f1ea, bubbleEdge: 0x1b1e2a, smoke: 0x9a9aa0, night: 0x0a1030,
    hazard: 0xf2c200, dome: 0xd4140b, domeLight: 0xff7a6b, domeDark: 0x7d0602, alarm: 0xff2a1a, alarmOff: 0x5a1a1a,
    shockwave: 0xffb04a,
    terminal: 0x3ddc84, sea: 0x3f7fc0, sweat: 0x8fc6f0, marker: 0x3d4359, shredder: 0x4a4e5a, shredderTop: 0x5f6678,
  };
  const BLACK = 0x000000, WHITE = 0xffffff;
  const MEGAPHONE = 0xe8e4da;

  /** The wall's paint: the wall, its top edge, the panelling below the rail, the rail, and the lounge's own wall. */
  const PAINTS = {
    slate: { wall: 0x2f3446, top: 0x252a3a, wainscot: 0x272b3b, rail: 0x3d4359, lounge: 0x353447 },
    sage: { wall: 0x34463d, top: 0x2a3931, wainscot: 0x2b3a32, rail: 0x485c50, lounge: 0x3b4a43 },
    clay: { wall: 0x4b3631, top: 0x3e2c28, wainscot: 0x3c2b27, rail: 0x60463f, lounge: 0x51393b },
    cream: { wall: 0xb5ad98, top: 0xa39b86, wainscot: 0x8f8773, rail: 0xcac2ad, lounge: 0xc0b6a0 },
  };
  /** The lounge's carpet, and its edge along the office's floor. */
  const LOUNGES = {
    navy: [0x3f4a5c, 0x353e4e], teal: [0x2f5656, 0x284a4a], plum: [0x513d50, 0x453444], sand: [0x7b6e58, 0x6a5f4c],
  };
  /** The deck's text colour, for a theme that leaves it out: it marks the picked desk. */
  const INK = 0xececec;
  /** The edge of the deck's keys, for a theme that leaves it out: it rims the window onto the room. */
  const EDGE = 0x2c2c2c;
  const SHADOW = [BLACK, 0.25];

  /** A desk's paint for each effort level, from white to the ☢ dome's red. */
  const EFFORT_PAINT = { low: 0xf2efe9, medium: 0xf3cdb8, high: 0xee9f82, xhigh: 0xe0603f, max: 0xd4140b };
  /** Each agent wears its own colour. */
  const SHIRTS = { claude: 0xd97757, codex: 0x10a37f, gemini: 0x4c8bf5, opencode: 0x9aa0a6, grok: 0xe8e8e8 };
  /** Staff wear plain colours, none of them an agent's. */
  const STAFF_SHIRTS = [0x8a8f9c, 0x3e4a66, 0xd8d4c8, 0xb08a3a, 0x6b7f5a];
  /** The deck's own colours for each state, for a theme that leaves one out. */
  const STANDARD_STATES = { idle: '#f2f2f2', thinking: '#3b82f6', asking: '#ff8a1f', unread: '#22c55e', error: '#ef4444' };

  /** A colour for the canvas: `hex`, darkened by `shade`, at `alpha`. */
  function css(hex, alpha = 1, shade = 1) {
    const r = Math.round(((hex >> 16) & 0xff) * shade);
    const g = Math.round(((hex >> 8) & 0xff) * shade);
    const b = Math.round((hex & 0xff) * shade);
    return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.max(0, alpha)})`;
  }

  /** A colour at six tenths of its brightness, for the side of something lit from above. */
  function darker(hex) {
    const part = (shift) => Math.round(((hex >> shift) & 0xff) * 0.6) << shift;
    return part(16) | part(8) | part(0);
  }

  /** A colour as the deck's theme writes it, `#rrggbb`, as a number. */
  function fromCss(text) {
    return /^#[0-9a-f]{6}$/i.test(text || '') ? parseInt(text.slice(1), 16) : null;
  }

  const SKINS = [0xf6d3b3, 0xe8b48a, 0xc98e5f, 0x9b6a43, 0x6e4a2e];
  const HAIRS = [0x2a1d16, 0x4a3022, 0x8a5a2b, 0xd9b26a, 0x1a1a1a, 0x9a9aa0, 0xa8432a];
  const HAIR_STYLES = ['short', 'long', 'spiky', 'bun'];

  /**
   * How a person looks, the same every time for the same project: the
   * project's name, hashed with FNV-1a, picks the skin, hair and hairstyle.
   * `phase` spreads out blinks and floating things, so no two people move
   * in step.
   */
  function lookOf(seed) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(seed)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return {
      skin: SKINS[Number(hash % 5n)],
      hair: HAIRS[Number((hash / 5n) % 7n)],
      hairStyle: HAIR_STYLES[Number((hash / 35n) % 4n)],
      phase: Number((hash / 140n) % 1000n) / 1000,
    };
  }

  const random = (low, high) => low + Math.random() * (high - low);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /* ----------------------------------------------------------- the people */

  /**
   * What a tool has its agent do: 'read' (leafing through papers), 'shell'
   * (a terminal on screen), 'web' (a globe on the desk), 'todo' (the
   * whiteboard) or 'type'. Each agent names its tools its own way.
   */
  function toolKind(tool) {
    const name = (tool || '').toLowerCase();
    if (!name) return null;
    if (['read', 'notebookread', 'read_file', 'read_many_files', 'grep', 'glob', 'search_file_content'].includes(name)) return 'read';
    if (['bash', 'shell', 'run_shell_command'].includes(name)) return 'shell';
    if (['webfetch', 'web_fetch', 'websearch', 'web_search', 'google_web_search'].includes(name)) return 'web';
    if (name === 'todowrite') return 'todo';
    return 'type';
  }

  /** One of an agent's subagents: a smaller person who comes to help at their desk. */
  class Intern {
    constructor(subagent, session) {
      this.id = subagent.id;
      this.agentId = session.id;
      this.agent = session.agent; // they wear their agent's colour
      this.look = lookOf(`${subagent.type} ${subagent.id}`);
      this.position = { ...DOOR };
      this.path = [];
      this.place = 'door';
      this.slot = null;       // where round the desk they stand; none while it's crowded
      this.isLeaving = false; // their subagent has stopped
    }

    get isWalking() { return this.path.length > 0; }
  }

  /** One session, as a person in the office, or one of the office's own staff. */
  class Person {
    constructor(session, desk) {
      this.session = session;
      this.desk = desk; // staff have none
      this.look = lookOf(session.name);
      this.place = desk === null ? 'door' : deskPlace(desk);
      this.position = desk === null ? { ...DOOR } : seat(desk);
      this.path = [];          // the points still to walk through
      this.isLeaving = false;  // their session has ended: they're on their way out
      // The effort their desk is painted for. It catches up with the
      // session's when they press the nuclear button.
      this.deskEffort = session.effort;
      // The last ☢ Max press they've answered, so only a new one sends them.
      this.answeredPress = session.maxPressedAt;
      this.isGoingNuclear = false;
      // Their session has shown max since the press. Until it does, the
      // press is still on its way to the agent, and an old effort means
      // nothing.
      this.sawMax = false;
      this.pressedAt = null;
      this.isFacingAway = false;
      this.nextMove = Infinity; // when an idle person next decides where to go
      this.arrivedAt = 0;
      this.toolSince = 0; // when their session's current tool started
    }

    get isWalking() { return this.path.length > 0; }
    get isStaff() { return this.desk === null; }

    /** Settled at their own desk, where its keyboard and mug are theirs. */
    get isAtDesk() {
      return this.desk !== null && !this.isWalking && !this.isLeaving && this.place === deskPlace(this.desk);
    }
  }

  /**
   * The people in the office and where they're going, moved on a little each
   * frame.
   *
   * The deck says what each session is doing; everything else is the
   * office's own: anyone with work to do goes to their desk, and anyone idle
   * wanders between their desk and the lounge. A press of ☢ Max sends its
   * agent running to the nuclear button. Staff fill the lounge while the
   * desks are quiet, and make way for the agents.
   */
  class Office {
    constructor() {
      this.people = [];
      this.seats = [];
      this.colours = {};
      this.nuclearQueue = []; // everyone going nuclear, in the order they set off; the first presses
      this.detonation = null; // the last press of the button: { desk, at }
      // The people in the first snapshot after connecting are already at
      // work; later ones walk in.
      this.isOpen = false;
      this.lastStep = null;
      this.nextStaffChange = 0;
      this.staffHired = 0; // numbers each new member of staff, for a face of their own
      this.interns = [];
    }

    /**
     * Furnishes the office as the layout says. Anyone at a spot by a corner
     * piece that has gone, or at a whiteboard that has moved, goes elsewhere:
     * an agent to their desk, staff to another spot, or home.
     */
    furnish(given) {
      const next = roomOf(given);
      if (JSON.stringify(next) === JSON.stringify(decor)) return;
      const cornerGone = next.corner !== decor.corner;
      const boardGone = next.wall.indexOf('whiteboard') !== decor.wall.indexOf('whiteboard');
      decor = next;
      spots = [...LOUNGE_SPOTS, ...CORNER_SPOTS[decor.corner]];
      boardSpots = boardSpotsOf(decor);
      for (const person of this.people) {
        if (person.isLeaving) continue;
        const spot = spotOf(person.place);
        const stranded = (cornerGone && spot !== null && spot >= LOUNGE_SPOTS.length) || (boardGone && person.place.startsWith('board:'));
        if (!stranded) continue;
        if (!person.isStaff) {
          this.send(person, deskPlace(person.desk));
          continue;
        }
        const free = this.freeSpots(person);
        if (free.length) {
          this.send(person, spotPlace(pick(free)));
        } else {
          person.isLeaving = true;
          this.send(person, 'door');
        }
      }
    }

    apply(seats, colours, now) {
      this.seats = seats.slice(0, DESKS.length);
      this.colours = colours || {};

      const current = new Map();
      this.seats.forEach((s, desk) => { if (s.session) current.set(s.session.id, { desk, session: s.session }); });
      // Someone on their way out isn't there any more: a session back on a
      // key in the meantime gets a person of its own.
      const known = new Set(this.people.filter((p) => !p.isLeaving).map((p) => p.session.id));
      const newcomers = new Map([...current].filter(([id]) => !known.has(id)));

      for (const person of this.people) {
        if (person.isLeaving || person.isStaff) continue;
        const placement = current.get(person.session.id);
        const successor = placement ? null : [...newcomers].find(([, n]) => n.desk === person.desk);
        if (placement) {
          this.update(person, placement, now);
        } else if (successor) {
          // A new session at the same desk is the same tab after /clear: the
          // same person, carrying on.
          newcomers.delete(successor[0]);
          person.answeredPress = successor[1].session.maxPressedAt;
          this.update(person, successor[1], now);
        } else {
          this.standDown(person);
          person.isLeaving = true;
          this.send(person, 'door');
        }
      }

      for (const placement of [...newcomers.values()].sort((a, b) => a.desk - b.desk)) {
        const person = new Person(placement.session, placement.desk);
        if (this.isOpen) {
          person.position = { ...DOOR };
          this.send(person, deskPlace(placement.desk));
        } else {
          person.arrivedAt = now;
          person.nextMove = now + random(2, 12);
        }
        this.people.push(person);
      }
      if (!this.isOpen) {
        // Staff already in the lounge, like the agents at their desks.
        for (let i = 0; i < this.staffWanted; i++) {
          const free = this.freeSpots(null);
          if (!free.length) break;
          const spot = pick(free);
          const member = this.hireStaff();
          member.place = spotPlace(spot);
          member.position = { x: spots[spot].x, y: spots[spot].y };
          member.isFacingAway = spots[spot].pose === 'away';
          member.arrivedAt = now - random(0, 20);
          member.nextMove = now + random(5, 25);
        }
        this.nextStaffChange = now + random(...STAFF_INTERVAL);
      }
      this.hireInterns();
      this.isOpen = true;
    }

    /**
     * Each running subagent gets an intern: new ones walk in through the
     * door (or are there already, in the first snapshot), and those whose
     * subagent has stopped walk out.
     */
    hireInterns() {
      const wanted = new Map();
      for (const s of this.seats) {
        if (s.session) for (const subagent of s.session.subagents || []) wanted.set(subagent.id, { subagent, session: s.session });
      }
      for (const intern of this.interns) {
        if (intern.isLeaving || wanted.has(intern.id)) continue;
        intern.isLeaving = true;
        // One that never got in just goes.
        if (intern.slot === null) intern.path = [];
        else intern.path = route(intern.position, 'door');
        intern.slot = null;
        intern.place = 'door';
      }
      const known = new Set(this.interns.map((i) => i.id));
      for (const [id, { subagent, session }] of wanted) {
        if (known.has(id)) continue;
        const intern = new Intern(subagent, session);
        intern.arrives = this.isOpen;
        this.interns.push(intern);
      }
    }

    /** The desk an agent's session is at, or null once it's gone. */
    deskOfSession(id) {
      const desk = this.seats.findIndex((s) => s.session && s.session.id === id);
      return desk < 0 ? null : desk;
    }

    /** Interns take free places round their agent's desk, at most four to a desk; the rest wait their turn. */
    placeInterns(now) {
      for (const intern of this.interns) {
        if (intern.isLeaving) continue;
        const desk = this.deskOfSession(intern.agentId);
        if (intern.slot !== null && intern.desk === desk) continue;
        intern.slot = null;
        const taken = new Set(this.interns.filter((i) => i !== intern && !i.isLeaving && i.desk === desk && i.slot !== null).map((i) => i.slot));
        const slot = INTERN_SLOTS.findIndex((_, i) => !taken.has(i));
        if (desk === null || slot < 0) continue;
        intern.desk = desk;
        intern.slot = slot;
        intern.place = `near:${desk}:${slot}`;
        if (intern.arrives) {
          intern.path = route(intern.position, intern.place);
        } else {
          intern.position = pointOf(intern.place);
          intern.path = [];
        }
        intern.arrives = true;
      }
      for (const intern of this.interns) this.walk(intern, this.elapsed, now);
      this.interns = this.interns.filter((i) => !(i.isLeaving && !i.isWalking));
    }

    /** Interns waiting for room at a desk, beyond the four round it. */
    waitingAt(desk) {
      return this.interns.filter((i) => !i.isLeaving && i.slot === null && this.deskOfSession(i.agentId) === desk).length;
    }

    /** The deck has gone: everyone leaves at once. */
    close() {
      this.people = [];
      this.seats = [];
      this.nuclearQueue = [];
      this.detonation = null;
      this.isOpen = false;
      this.nextStaffChange = 0;
      this.interns = [];
    }

    /** The effort a desk is painted for, if its session has one. */
    deskEffort(desk) {
      const person = this.people.find((p) => p.desk === desk && !p.isLeaving);
      return person && person.deskEffort ? person.deskEffort : null;
    }

    step(now) {
      this.elapsed = Math.min(now - (this.lastStep ?? now), 0.1);
      this.lastStep = now;
      this.changeStaff(now);
      for (const person of this.people) {
        this.decide(person, now);
        this.walk(person, this.elapsed, now);
      }
      this.press(now);
      this.people = this.people.filter((p) => !(p.isLeaving && !p.isWalking));
      this.placeInterns(now);
    }

    /**
     * The first in line, once at the button: hand up, then down on the dome,
     * then a moment to watch before going back to their desk.
     */
    press(now) {
      const presser = this.nuclearQueue[0];
      if (!presser || presser.place !== 'button' || presser.isWalking) return;
      const held = now - presser.arrivedAt;
      if (presser.pressedAt === null && held >= WIND_UP) {
        presser.pressedAt = now;
        presser.deskEffort = presser.session.effort;
        this.detonation = { desk: presser.desk, at: now };
      } else if (held >= WIND_UP + AFTERGLOW) {
        this.standDown(presser);
        this.send(presser, deskPlace(presser.desk));
      }
    }

    /* Staff */

    get staffWanted() {
      return Math.max(0, STAFF_WHEN_EMPTY - this.people.filter((p) => !p.isStaff && !p.isLeaving).length);
    }

    hireStaff() {
      this.staffHired += 1;
      const name = `staff ${this.staffHired}`;
      const member = new Person({ id: name, name, state: 'idle', effort: '', agent: 'claude' }, null);
      this.people.push(member);
      return member;
    }

    /** One arrives or one leaves, then a pause before the next. */
    changeStaff(now) {
      if (!this.isOpen || now < this.nextStaffChange) return;
      const present = this.people.filter((p) => p.isStaff && !p.isLeaving);
      const free = this.freeSpots(null);
      if (present.length < this.staffWanted && free.length) {
        this.send(this.hireStaff(), spotPlace(pick(free)));
      } else if (present.length > this.staffWanted) {
        const leaver = present.find((p) => !p.isWalking) || present[0];
        leaver.isLeaving = true;
        this.send(leaver, 'door');
      } else {
        return;
      }
      this.nextStaffChange = now + random(...STAFF_INTERVAL);
    }

    /** Lounge spots nobody else has taken. Agents don't count staff, who make way for them. */
    freeSpots(person) {
      const agent = person ? !person.isStaff : false;
      return spots.map((_, spot) => spot).filter((spot) => !this.people.some((other) =>
        other !== person && !other.isLeaving && other.place === spotPlace(spot) && !(agent && other.isStaff)));
    }

    standDown(person) {
      person.isGoingNuclear = false;
      person.pressedAt = null;
      person.deskEffort = person.session.effort;
      this.nuclearQueue = this.nuclearQueue.filter((p) => p !== person);
    }

    update(person, placement, now) {
      const wasIdle = person.session.state === 'idle';
      const session = placement.session;
      if (session.tool !== person.session.tool) person.toolSince = now;
      person.session = session;

      // Only a press of ☢ Max sends them to the button; the dial reaching max
      // just repaints the desk. Turned back down before they get there, they
      // go back to their desk.
      const pressed = session.maxPressedAt;
      if (pressed && pressed !== person.answeredPress && !person.isGoingNuclear) {
        person.isGoingNuclear = true;
        person.sawMax = false;
        this.nuclearQueue.push(person);
      }
      if (person.isGoingNuclear && session.effort === 'max') person.sawMax = true;
      if (person.isGoingNuclear && person.sawMax && session.effort !== 'max' && person.pressedAt === null) {
        this.standDown(person);
        this.send(person, deskPlace(placement.desk));
      }
      person.answeredPress = pressed;
      if (!person.isGoingNuclear) person.deskEffort = session.effort;

      if (person.desk !== placement.desk) {
        person.desk = placement.desk;
        if (deskOf(person.place) !== null) this.send(person, deskPlace(placement.desk));
      }
      // Done and seen: a moment to stretch before getting up.
      if (session.state === 'idle' && !wasIdle && !person.isWalking) person.nextMove = now + random(3, 6);
    }

    decide(person, now) {
      if (person.isLeaving) return;
      if (person.isStaff) {
        // Staff only ever move between lounge spots.
        if (person.isWalking || now < person.nextMove) return;
        const free = this.freeSpots(person);
        if (free.length) this.send(person, spotPlace(pick(free)));
        else person.nextMove = now + random(5, 10);
        return;
      }
      const desk = deskPlace(person.desk);
      if (person.isGoingNuclear) {
        const place = this.nuclearQueue[0] === person ? 'button' : 'queue';
        if (person.place !== place) this.send(person, place);
        return;
      }
      const duty = this.dutyOf(person, now);
      if (duty) {
        if (person.place !== duty) this.send(person, duty);
        return;
      }
      // Nothing to do any more, away from the desk on a job: back to it first.
      if (/^(board|clock|shred):/.test(person.place)) {
        this.send(person, desk);
        return;
      }
      if (person.isWalking || now < person.nextMove) return;

      const free = this.freeSpots(person);
      const backToDesk = person.place !== desk && (!free.length || Math.random() < 0.35);
      if (backToDesk) {
        this.send(person, desk);
      } else if (free.length) {
        const spot = pick(free);
        this.send(person, spotPlace(spot));
        // Whoever of the staff is there finds somewhere else to be.
        for (const member of this.people) if (member.isStaff && member.place === spotPlace(spot)) member.nextMove = now;
      } else {
        person.nextMove = now + random(8, 20);
      }
    }

    /**
     * Where a session's work takes its agent, or null when it has none and
     * they're free to wander: the shredder while it compacts, the clock while
     * it waits out a rate limit, the whiteboard for a to-do list that takes a
     * while, and otherwise their desk.
     */
    dutyOf(person, now) {
      const s = person.session, desk = deskPlace(person.desk);
      if (s.compacting) return `shred:${person.desk}`;
      if (s.state === 'error' && s.errorKind === 'rate_limit') return this.wallSpot(person, 'clock', CLOCK_SPOTS.length) || desk;
      if (s.state === 'thinking' && toolKind(s.tool) === 'todo' && now - person.toolSince >= LONG_TOOL) {
        return this.wallSpot(person, 'board', boardSpots.length) || desk;
      }
      return s.state === 'idle' ? null : desk;
    }

    /** One of the spots along the back wall nobody else has taken. */
    wallSpot(person, kind, count) {
      if (person.place.startsWith(`${kind}:`)) return person.place;
      for (let i = 0; i < count; i++) {
        const place = `${kind}:${i}`;
        if (!this.people.some((p) => p !== person && !p.isLeaving && p.place === place)) return place;
      }
      return null;
    }

    send(person, place) {
      person.place = place;
      person.path = route(person.position, place);
      person.nextMove = Infinity;
    }

    walk(person, elapsed, now) {
      const target = person.path[0];
      if (!target) return;
      const dx = target.x - person.position.x, dy = target.y - person.position.y;
      const distance = Math.hypot(dx, dy);
      const stride = WALKING_SPEED * (person.isGoingNuclear ? HURRY : 1) * elapsed;
      if (distance > stride) {
        person.position.x += (dx / distance) * stride;
        person.position.y += (dy / distance) * stride;
        person.isFacingAway = dy < 0 && Math.abs(dy) >= Math.abs(dx);
        return;
      }
      person.position = { x: target.x, y: target.y };
      person.path.shift();
      if (person.path.length) return;
      person.arrivedAt = now;
      const spot = spotOf(person.place);
      if (spot !== null) {
        person.isFacingAway = spots[spot].pose === 'away';
        person.nextMove = now + random(12, 30);
      } else {
        person.isFacingAway = person.place.startsWith('board:');
        person.nextMove = now + random(8, 20);
      }
    }
  }

  /** Art pixels a second: crossing the room takes about ten seconds. */
  const WALKING_SPEED = 28;
  /** Going nuclear is worth hurrying for. */
  const HURRY = 1.8;
  /** How long the presser holds their hand up before bringing it down. */
  const WIND_UP = 0.45;
  /** How long they stay to watch, after pressing, before heading back. */
  const AFTERGLOW = 1.6;
  /** Staff in the lounge with no sessions running; one fewer for each that is. */
  const STAFF_WHEN_EMPTY = 4;
  /** Staff arrive and leave one at a time, this many seconds apart. */
  const STAFF_INTERVAL = [3, 6];
  /** Only a tool that's been running this long gets its agent up from the desk, so nobody jitters back and forth. */
  const LONG_TOOL = 1.5;

  /* ------------------------------------------------------------ drawing */

  const SHAKE_LENGTH = 0.6;
  const FLASH_LENGTH = 0.6;
  const SHOCKWAVE_LENGTH = 1;
  /** How long the warning light turns after a press. */
  const ALARM_LENGTH = 4;
  /** The desk labels' text, in art pixels… */
  const LABEL_SIZE = 3.4;
  /** …and never smaller than this on screen, in CSS pixels, so a phone can read it. */
  const LABEL_SMALLEST = 8;
  /**
   * How long a turn has run, short enough for its monitor: 9:41 for the
   * first ten minutes, then 12m, then 2h.
   */
  function turnLength(seconds) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 10) return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    if (minutes < 60) return `${minutes}m`;
    return `${Math.min(Math.floor(minutes / 60), 99)}h`;
  }

  /** After this long, a turn's timer shows its agent sweating, in seconds. */
  const LONG_TURN = 600;
  /** Digits and a few marks, three art pixels wide and five tall, for timers and counts. */
  const GLYPHS = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'], 8: ['111', '101', '111', '101', '111'],
    9: ['111', '101', '111', '001', '111'], ':': ['0', '1', '0', '1', '0'], '+': ['000', '010', '111', '010', '000'],
    m: ['000', '000', '111', '111', '101'], h: ['100', '100', '111', '101', '101'],
  };
  /** How long everyone looks up when the mic goes on, as if the boss were shouting. */
  const LOOK_UP_LENGTH = 1;
  /** The listener's nod, once the mic is let go. */
  const NOD_LENGTH = 0.6;
  /** A wobble, for the button or the mic tapped with no desk picked. */
  const WOBBLE_LENGTH = 0.4;
  /** Sound waves leave the mic this often while it's held, and spread this far. */
  const WAVE_EVERY = 0.5;
  const WAVE_REACH = 110;

  /**
   * Where the deck's own controls are out of sight (full screen, /office, the
   * pop-out window), the picked agent waiting on you gets keys in place of
   * its bubble: ▲ ▼ through the options, ✓ to accept, ✕ to reject. Each key,
   * in art pixels…
   */
  const CHOICE_KEY = { w: 16, h: 14 };
  /** …the gap between keys, and the wider one between the arrows and the answers… */
  const CHOICE_GAP = 3;
  const CHOICE_SPLIT = 6;
  /** …and from the panel's edge to the keys. */
  const CHOICE_INSET = 3;
  /** A tapped key stays down at least this long, so even a quick tap shows. */
  const CHOICE_PRESS_LENGTH = 0.15;
  /** Each key's mark, a row of art pixels at a time. */
  const CHOICE_MARKS = {
    up: ['0001000', '0011100', '0111110', '1111111'],
    down: ['1111111', '0111110', '0011100', '0001000'],
    accept: ['0000011', '0000110', '1101100', '0111000', '0010000'],
    reject: ['11011', '01110', '00100', '01110', '11011'],
  };

  /**
   * Where the dial is out of sight, a finger held on a Claude Code desk puts
   * paint chips along its front, one for each effort from white for low to
   * red for max, the colours the desk is painted in: a tap on one sets that
   * effort, as the dial does, and puts them away. Each chip, in art pixels,
   * and the gap between them.
   */
  const CHIP = { w: 11, h: 10 };
  /** They come out for a finger held this long on the desk or its person, in seconds: a tap only picks it. */
  const HOLD_FOR_CHIPS = 0.45;
  const CHIP_GAP = 1;
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

  /** The chips on the desk `desk`: across its front, a little wider than it, kept inside the room. */
  function effortChips(desk) {
    const { x, y } = DESKS[desk];
    const w = EFFORTS.length * CHIP.w + (EFFORTS.length - 1) * CHIP_GAP;
    const left = Math.max(1, Math.min(WIDTH - 1 - w, Math.round(x + DESK_WIDTH / 2 - w / 2)));
    return { left, top: y + 5, w, h: CHIP.h, chips: EFFORTS.map((level, i) => ({ level, x: left + i * (CHIP.w + CHIP_GAP), y: y + 5 })) };
  }

  /** The choice keys for the agent at `desk`: a panel just above its head, pointing down at it, kept inside the room. */
  function choicePanel(desk) {
    const w = CHOICE_INSET * 2 + CHOICE_KEY.w * 4 + CHOICE_GAP * 2 + CHOICE_SPLIT;
    const h = CHOICE_INSET * 2 + CHOICE_KEY.h;
    const tip = { x: seat(desk).x - 1, y: DESKS[desk].y - 15 };
    const left = Math.max(1, Math.min(WIDTH - 1 - w, tip.x - Math.floor(w / 2)));
    const top = tip.y - 1 - h;
    let x = left + CHOICE_INSET;
    const keys = ['up', 'down', 'accept', 'reject'].map((action, i) => {
      const key = { action, x, y: top + CHOICE_INSET };
      x += CHOICE_KEY.w + (i === 1 ? CHOICE_SPLIT : CHOICE_GAP);
      return key;
    });
    return { left, top, w, h, tip, keys };
  }

  /** What a person is doing with their body, at `now`. */
  function poseOf(person, now) {
    if (person.isWalking) return { kind: 'walk', step: Math.floor(now * 6) % 2 };
    if (person.isGoingNuclear && person.place === 'button') return { kind: 'press', raised: person.pressedAt === null };
    if (person.place.startsWith('board:')) return { kind: 'write', stroke: Math.floor(now * 3) % 2 };
    if (person.place.startsWith('clock:')) return { kind: 'tap', beat: Math.floor(now * 4) % 2 };
    if (person.place.startsWith('shred:')) return { kind: 'shred' };
    if (deskOf(person.place) !== null) {
      if (person.session.state === 'asking') return { kind: 'wave', frame: Math.floor(now * 4) % 2 };
      if (person.session.state === 'error') return { kind: 'slump' };
      return { kind: 'sit' };
    }
    const spot = spotOf(person.place);
    if (spot !== null) return { kind: spots[spot].pose === 'sit' ? 'sit' : 'stand' };
    return { kind: 'stand' };
  }

  /** The top row of a person's hair. Sitting lowers it; standing at the desk to wave raises them back up. */
  function topOf(person, pose) {
    const feet = Math.round(person.position.y);
    if (pose.kind === 'sit') return feet - 15;
    if (pose.kind === 'slump') return feet - 14;
    return feet - 17;
  }

  /**
   * Where the room goes on a canvas `width` × `height`, at least `margin`
   * from its edges: a whole number of the screen's pixels to each art pixel
   * keeps every edge sharp, and what's left over is a border round it.
   */
  function fitRoom(width, height, margin = 0) {
    const fit = Math.min((width - margin * 2) / WIDTH, (height - margin * 2) / HEIGHT);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    return { scale, ox: Math.round((width - WIDTH * scale) / 2), oy: Math.round((height - HEIGHT * scale) / 2) };
  }

  /**
   * Beside the phone's controls, the room is seen through a window: its
   * corners rounded like the deck's keys, a shadow inside its edge, and the
   * edge itself. In CSS pixels.
   */
  const WINDOW_CORNER = 16;
  const WINDOW_SHADOW = 10;
  /** The shadow at the window's edge, fading to nothing WINDOW_SHADOW in. */
  const WINDOW_SHADOW_DEPTH = 0.32;

  /**
   * Floating, the room's window fills its space but for a margin of the
   * deck's background, with a soft shadow under it, and the office goes on
   * past the room to the window's edges. The margin is wider in the pop-out
   * window, which has its own edge round it, than on a whole screen, where
   * every pixel counts. In CSS pixels.
   */
  const FLOAT_MARGINS = { window: 14, screen: 6 };
  /**
   * How far the office goes on past the room, at most: half the room's
   * width or height each way. Beyond that, as on a phone held upright, it
   * would be bare wall and floor.
   */
  const FLOAT_REACH = 1.5;
  const FLOAT_SHADOW = 16;
  const FLOAT_DROP = 3;
  /**
   * While an agent waits on you, the floating window's edge glows in the
   * waiting colour, rising and falling once in this many seconds: the
   * pop-out is mostly seen out of the corner of an eye.
   */
  const GLOW_PERIOD = 1.6;
  const GLOW_REACH = 14;

  /**
   * Draws one frame of the office: the room, then everything on the floor
   * from back to front, then what floats above it: the screens' light, the
   * speech bubbles and the name on each desk.
   */
  function drawOffice(ctx, office, frame) {
    const { now, hour, minute, width, height, ratio, selected, mic, framed, floating } = frame;
    const inset = floating ? FLOAT_MARGINS[floating] * ratio : 0;
    const room = fitRoom(width, height, inset);
    const { scale } = room;
    let { ox, oy } = room;

    // The room shakes for a moment when the button goes down.
    const blast = office.detonation;
    const sinceBlast = blast ? now - blast.at : Infinity;
    if (sinceBlast >= 0 && sinceBlast < SHAKE_LENGTH) {
      const amplitude = (1 - sinceBlast / SHAKE_LENGTH) * 1.5;
      ox += Math.round(Math.sin(sinceBlast * 90) * amplitude) * scale;
      oy += Math.round(Math.cos(sinceBlast * 71) * amplitude) * scale;
    }

    /** Fills art pixels: whole squares of the room. `color` is a hex number or [hex, alpha]. */
    function fill(x, y, w, h, color, alpha = 1) {
      const [hex, a] = Array.isArray(color) ? color : [color, alpha];
      if (a <= 0) return;
      ctx.fillStyle = css(hex, a);
      ctx.fillRect(ox + Math.round(x) * scale, oy + Math.round(y) * scale, Math.round(w) * scale, Math.round(h) * scale);
    }
    const dot = (x, y, color, alpha) => fill(x, y, 1, 1, color, alpha);
    /** Where an art pixel lands on the canvas, for what's drawn at the screen's own resolution. */
    const screen = (x, y) => ({ x: ox + x * scale, y: oy + y * scale });

    /** How wide `text` is in the pixel font. */
    const pixelWidth = (text) => [...text].reduce((w, c) => w + GLYPHS[c][0].length + 1, -1);

    /** A few digits in art pixels, on a dark backing unless what's under them is dark already. */
    function pixelText(text, x, y, color, backing = true) {
      if (backing) fill(x - 1, y - 1, pixelWidth(text) + 2, 7, PALETTE.frame, 0.75);
      let at = x;
      for (const c of text) {
        GLYPHS[c].forEach((row, r) => [...row].forEach((on, column) => { if (on === '1') dot(at + column, y + r, color); }));
        at += GLYPHS[c][0].length + 1;
      }
    }

    // The sky keeps the computer's time, or it's always the middle of the day.
    const daylight = decor.sky === 'day' ? 12 : hour;
    const isNight = daylight >= 20 || daylight < 5;
    const alarm = sinceBlast >= 0 && sinceBlast < ALARM_LENGTH ? sinceBlast : null;
    const colour = (state) => fromCss(office.colours[state]) ?? fromCss(STANDARD_STATES[state]);
    const ink = fromCss(office.colours.ink) ?? INK;
    const sessionAt = (desk) => (desk < office.seats.length ? office.seats[desk].session : null);
    const selectedDesk = office.seats.findIndex((s) => s.session && s.session.id === selected);
    /** How far a wobbling thing is pushed sideways, in art pixels. */
    const wobble = (what) => (frame.wobble && frame.wobble.what === what && now - frame.wobble.at < WOBBLE_LENGTH
      ? Math.round(Math.sin((now - frame.wobble.at) * 50)) : 0);
    const lookingUp = mic.heldAt !== null && now - mic.heldAt < LOOK_UP_LENGTH;

    ctx.clearRect(0, 0, width, height);

    // Through a window, the room stays inside it, even while it shakes.
    let glass = framed && { x: room.ox, y: room.oy, w: WIDTH * scale, h: HEIGHT * scale, r: WINDOW_CORNER * ratio };
    if (floating) {
      const w = Math.min(width - inset * 2, WIDTH * scale * FLOAT_REACH);
      const h = Math.min(height - inset * 2, HEIGHT * scale * FLOAT_REACH);
      glass = { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h, r: WINDOW_CORNER * ratio };
    }
    // What can be seen of the office, in art pixels: the room, and floating,
    // as much of the wall and floor round it as fills the window.
    const seen = floating
      ? { left: Math.floor((glass.x - ox) / scale), top: Math.floor((glass.y - oy) / scale),
          right: Math.ceil((glass.x + glass.w - ox) / scale), bottom: Math.ceil((glass.y + glass.h - oy) / scale) }
      : { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
    seen.width = seen.right - seen.left;
    seen.height = seen.bottom - seen.top;
    // Floating, the window glows while anyone waits on you.
    const calling = floating && office.seats.some((s) => s.session && s.session.state === 'asking');
    const glow = calling ? 0.5 - 0.5 * Math.cos((now / GLOW_PERIOD) * 2 * Math.PI) : 0;
    if (floating) drawFloat(glass);
    if (glass) {
      ctx.save();
      roundedRect(ctx, glass.x, glass.y, glass.w, glass.h, glass.r);
      ctx.clip();
    }

    /* The room */

    function sky() {
      const hour = daylight;
      if (hour >= 5 && hour < 7) return [0x4a5a9a, 0xe8b08a];
      if (hour >= 7 && hour < 17) return [0x7fb8e8, 0xa9d3f2];
      if (hour >= 17 && hour < 20) return [0x5b5aa0, 0xf0a070];
      return [0x0c1230, 0x1a2448];
    }

    function drawWindow(x, y, w, h, moon) {
      const [top, bottom] = sky();
      fill(x - 1, y - 1, w + 2, h + 2, PALETTE.frame);
      fill(x, y, w, h / 2, top);
      fill(x, y + h / 2, w, h / 2, bottom);
      if (isNight) {
        for (const [sx, sy] of [[3, 2], [11, 6], [20, 3], [26, 8], [7, 12], [17, 14]]) if (sx < w) dot(x + sx, y + sy, WHITE, 0.75);
        if (moon) fill(x + w - 9, y + 3, 3, 3, 0xf1ead2);
      } else if (daylight >= 7 && daylight < 17) {
        const drift = (x * 7) % (w - 12);
        fill(x + 3 + drift, y + 4, 7, 2, WHITE, 0.85);
        fill(x + 5 + drift, y + 3, 3, 1, WHITE, 0.85);
      }
      fill(x + w / 2, y, 1, h, PALETTE.frame);
      fill(x, y + h / 2, w, 1, PALETTE.frame);
      fill(x - 2, y + h + 1, w + 4, 1, PALETTE.sill);
    }

    /** The door stands open while someone passes through it. */
    function drawDoor() {
      const open = office.people.some((p) => Math.hypot(p.position.x - DOOR.x, p.position.y - DOOR.y) < 14);
      fill(205, 13, 18, 27, PALETTE.frame);
      if (open) {
        fill(207, 15, 14, 25, PALETTE.doorway);
        fill(207, 15, 3, 25, PALETTE.door);
      } else {
        fill(207, 15, 14, 25, PALETTE.door);
        fill(209, 17, 10, 9, PALETTE.doorPanel);
        fill(209, 28, 10, 10, PALETTE.doorPanel);
        fill(218, 27, 1, 2, PALETTE.brass);
      }
    }

    /** A clock above the door, keeping the computer's time. */
    function drawClock(x, y) {
      for (const [radius, color] of [[5.5, PALETTE.frame], [4.5, PALETTE.bubble]]) {
        for (let row = -Math.floor(radius); row <= Math.floor(radius); row++) {
          const half = Math.floor(Math.sqrt(radius * radius - row * row));
          fill(x - half, y + row, half * 2 + 1, 1, color);
        }
      }
      const hand = (turns, length, color) => {
        for (let step = 1; step <= length; step++) {
          const angle = turns * 2 * Math.PI;
          dot(x + Math.round(Math.sin(angle) * step), y - Math.round(Math.cos(angle) * step), color);
        }
      };
      hand(minute / 60, 3, PALETTE.eye);
      hand(((hour % 12) + minute / 60) / 12, 2, 0xd96a5a);
      dot(x, y, PALETTE.eye);
    }

    function drawWall() {
      const { left, top, right, width: across } = seen;
      const paint = PAINTS[decor.paint];
      fill(left, top, LOUNGE_LEFT - left, WALL_BOTTOM - top, paint.wall);
      fill(LOUNGE_LEFT, top, right - LOUNGE_LEFT, WALL_BOTTOM - top, paint.lounge);
      fill(left, top, across, 2, paint.top);
      fill(left, 30, across, 8, paint.wainscot);
      fill(left, 30, across, 1, paint.rail);
      fill(left, 38, across, 2, PALETTE.baseboard);
      fill(LOUNGE_LEFT, top, 1, WALL_BOTTOM - top, paint.top);

      decor.wall.forEach((piece, slot) => drawWallPiece(piece, WALL_SLOTS[slot]));
      drawWindow(260, 6, 30, 20, true);

      drawDoor();
      drawClock(CORRIDOR_X, 6);

      // The warning light beside the door, lit while the alarm sounds
      fill(195, 27, 7, 2, PALETTE.frame);
      if (alarm === null) fill(196, 23, 5, 4, PALETTE.alarmOff);
      else fill(196, 23, 5, 4, PALETTE.alarm, 0.75 + 0.25 * Math.sin(alarm * 20));
      fill(197, 23, 2, 1, WHITE, alarm === null ? 0.15 : 0.6);
    }

    /** A shelf of books, `w` wide and six high, from `l`, `y`: `row` varies them from shelf to shelf. */
    function drawBooks(l, y, w, row) {
      const colours = [0xd96a5a, 0x4c8bf5, 0xf2d35b, 0x4f9a5a, 0xeae6dc, 0x9a6ad0, 0xe08a3a];
      fill(l, y, w, 6, PALETTE.doorway);
      for (let b = 0, bx = l + 1; bx < l + w - 2; b++) {
        const width = Math.min(2 + ((b + row) % 2), l + w - 1 - bx), height = 4 + (((b * 3 + row) % 3) % 2);
        fill(bx, y + 6 - height, width, height, colours[(b * 2 + row * 3) % colours.length]);
        bx += width + (b % 4 === 3 ? 2 : 0);
      }
      fill(l, y + 6, w, 1, PALETTE.deskEdge);
    }

    /** One of the back wall's places, as set up, around its middle `x`. */
    function drawWallPiece(piece, x) {
      switch (piece) {
        case 'window':
          return drawWindow(x - 16, 6, 32, 20, false);
        case 'whiteboard': {
          const l = x - 12;
          fill(l, 9, 24, 16, 0xb8bfcc);
          fill(l + 1, 10, 22, 14, PALETTE.whiteboard);
          fill(l + 3, 12, 10, 1, 0x4c8bf5);
          fill(l + 3, 15, 14, 1, 0xd96a5a);
          fill(l + 3, 18, 8, 1, 0x4f9a5a);
          fill(l + 15, 18, 5, 1, 0x4c8bf5);
          // A to-do list, written up line by line while someone stands at the first whiteboard
          if (x === WALL_SLOTS[decor.wall.indexOf('whiteboard')]) {
            for (const person of office.people) {
              const spot = numberAfter('board:', person.place);
              if (spot === null || person.isWalking) continue;
              const length = 1 + (Math.floor((now - person.arrivedAt) * 3) % 9);
              fill(spot === 0 ? l + 2 : l + 13, 21, length, 1, PALETTE.marker);
            }
          }
          return fill(l, 25, 24, 1, PALETTE.frame);
        }
        case 'pinboard': {
          const l = x - 10;
          fill(l, 10, 20, 16, PALETTE.doorPanel);
          fill(l + 1, 11, 18, 14, PALETTE.cork);
          fill(l + 3, 13, 4, 4, 0xf2d35b);
          fill(l + 9, 14, 5, 4, 0xf28fb0);
          fill(l + 4, 19, 5, 3, 0x8fc6f0);
          return fill(l + 12, 20, 4, 3, PALETTE.paper);
        }
        case 'poster': {
          // Mountains at sunset, framed
          const l = x - 8;
          fill(l, 7, 16, 20, PALETTE.frame);
          fill(l + 1, 8, 14, 9, 0xf0a070);
          fill(l + 1, 17, 14, 9, 0x5b5aa0);
          fill(l + 9, 10, 3, 3, 0xffe08a);
          for (let k = 0; k < 6; k++) fill(l + 2 + k, 20 - k, 1, 6 + k, 0x3e7a6a);
          for (let k = 0; k < 6; k++) fill(l + 8 + k, 15 + k, 1, 11 - k, 0x356b5c);
          fill(l + 6, 15, 2, 1, WHITE, 0.8);
          return fill(l + 1, 24, 14, 2, 0x2f5a4c);
        }
        case 'shelf': {
          // Books on three shelves, down to the rail
          const l = x - 13;
          fill(l, 7, 26, 23, PALETTE.counter);
          [8, 15, 22].forEach((shelf, row) => drawBooks(l + 1, shelf, 24, row));
          return;
        }
        case 'plant': {
          // A planter on a bracket, trailing leaves
          fill(x - 6, 20, 12, 1, PALETTE.frame);
          fill(x - 5, 15, 10, 5, PALETTE.pot);
          fill(x - 5, 15, 10, 1, 0x8a4f32);
          fill(x - 7, 11, 5, 4, PALETTE.leaf);
          fill(x - 2, 9, 5, 6, PALETTE.leafDark);
          fill(x + 3, 11, 5, 4, PALETTE.leaf);
          fill(x - 7, 15, 2, 9, PALETTE.leaf);
          fill(x + 6, 15, 2, 7, PALETTE.leafDark);
          return fill(x + 2, 20, 2, 5, PALETTE.leaf);
        }
        default:
          return; // bare
      }
    }

    function drawFloor() {
      const { left, right, bottom } = seen;
      const top = WALL_BOTTOM, depth = bottom - top, across = LOUNGE_LEFT - left;
      /** Squares of `size` from the room's corner outwards, cut at the lounge: `paint(x, y, column, row, width)` for each. */
      const squares = (size, paint) => {
        for (let y = top, r = 0; y < bottom; y += size, r++) {
          for (let x = Math.floor(left / size) * size; x < LOUNGE_LEFT; x += size) paint(x, y, Math.floor(x / size), r, Math.min(size, LOUNGE_LEFT - x));
        }
      };
      if (decor.floor === 'tiles') {
        fill(left, top, across, depth, 0x777a81);
        squares(9, (x, y, c, r, w) => fill(x, y, w - 1, 8, (c + r) % 2 === 0 ? 0x9c9fa6 : 0x8c8f96));
      } else if (decor.floor === 'concrete') {
        fill(left, top, across, depth, 0x73767b);
        squares(36, (x, y, c, r, w) => {
          fill(x, y, w, 1, 0x67696e);
          fill(x, y, 1, 36, 0x67696e);
          for (let k = 0; k < 7; k++) dot(x + ((c * 13 + r * 7 + k * 11) % 33) + 1, y + ((c * 5 + r * 17 + k * 9) % 33) + 2, 0x80838a);
        });
      } else if (decor.floor === 'carpet') {
        fill(left, top, across, depth, 0x4b5065);
        squares(12, (x, y, c, r, w) => {
          if ((c + r) % 2 === 0) fill(x, y, w, 12, 0x474c60);
          dot(x + ((c * 5 + r * 3) % 10) + 1, y + ((c * 7 + r) % 10) + 1, 0x565b71);
        });
      } else {
        fill(left, top, across, depth, PALETTE.wood);
        let row = 0;
        for (let y = top + 4; y < bottom + 4; y += 5, row++) {
          fill(left, y, across, 1, PALETTE.plankSeam);
          // The planks' ends, staggered from row to row, from the room's left edge outwards
          let x = (row % 3) * 11;
          while (x > left) x -= 33;
          for (; x < LOUNGE_LEFT; x += 33) fill(x, y - 4, 1, 4, PALETTE.plankSeam);
        }
      }
      const [carpet, carpetEdge] = LOUNGES[decor.lounge];
      fill(LOUNGE_LEFT, top, right - LOUNGE_LEFT, depth, carpet);
      fill(LOUNGE_LEFT, top, 1, depth, carpetEdge);
      fill(244, 124, 64, 20, PALETTE.rugEdge);
      fill(246, 126, 60, 16, PALETTE.rug);
      fill(207, 40, 14, 2, PALETTE.mat);
      fill(left, top, right - left, 1, SHADOW);
    }

    /* Furniture */

    function drawDesk(desk) {
      const { x, y } = DESKS[desk], s = seat(desk);

      // The monitor, from behind: its screen faces whoever sits here.
      fill(x + 6, y - 10, 13, 9, PALETTE.monitor);
      fill(x + 7, y - 9, 11, 7, PALETTE.monitorPanel);
      fill(x + 11, y - 1, 3, 2, PALETTE.monitorStand);

      // Painted for its session's effort, from white for low to red for max;
      // plain wood when there's none. It flashes as the button goes down.
      let paint = EFFORT_PAINT[office.deskEffort(desk)] ?? null;
      if (blast && blast.desk === desk && sinceBlast >= 0 && sinceBlast < 1.2 && Math.floor(sinceBlast * 6) % 2 === 0) paint = WHITE;
      const wood = (plain, shade) => (paint === null ? css(plain) : css(paint, 1, shade));
      const paintFill = (px, py, w, h, plain, shade) => {
        ctx.fillStyle = wood(plain, shade);
        ctx.fillRect(ox + px * scale, oy + py * scale, w * scale, h * scale);
      };

      paintFill(x, y, DESK_WIDTH, 1, PALETTE.deskEdge, 1);
      paintFill(x, y + 1, DESK_WIDTH, 4, PALETTE.deskTop, 0.9);
      fill(x + 9, y + 1, 7, 1, PALETTE.monitorStand);
      paintFill(x, y + 5, DESK_WIDTH, 11, PALETTE.deskFront, 0.72);
      paintFill(x, y + 5, DESK_WIDTH, 1, PALETTE.deskLip, 0.62);
      paintFill(x + 30, y + 8, 10, 6, PALETTE.drawer, 0.82);
      fill(x + 34, y + 10, 2, 1, PALETTE.handle);
      fill(x + 1, y + 16, DESK_WIDTH - 2, 1, SHADOW);
      fill(s.x - 5, y + 2, 10, 2, PALETTE.keyboard);
      fill(s.x - 4, y + 2, 8, 1, PALETTE.keys);

      // Something different on each desk
      if (desk % 3 === 0) {
        fill(x + 38, y - 2, 3, 3, PALETTE.pot);
        fill(x + 37, y - 5, 5, 3, PALETTE.leaf);
        dot(x + 39, y - 6, PALETTE.leafDark);
      } else if (desk % 3 === 1) {
        fill(x + 35, y + 1, 6, 3, PALETTE.paper);
        fill(x + 36, y + 2, 4, 1, PALETTE.counterTop);
      } else {
        fill(x + 39, y - 6, 1, 6, PALETTE.frame);
        fill(x + 36, y - 7, 5, 2, PALETTE.brass);
        fill(x + 37, y, 5, 1, PALETTE.frame);
      }

      const occupant = office.people.find((p) => p.desk === desk && p.isAtDesk);
      if (!occupant) return;
      const skin = occupant.look.skin;
      const tool = occupant.session.state === 'thinking' ? toolKind(occupant.session.tool) : null;
      if (tool === 'web') {
        // A little globe at the end of the desk, turning
        const turn = Math.floor(now * 4) % 5;
        fill(x + 2, y - 5, 3, 1, PALETTE.sea);
        fill(x + 1, y - 4, 5, 3, PALETTE.sea);
        fill(x + 2, y - 1, 3, 1, PALETTE.sea);
        fill(x + 1 + turn, y - 4, 1, 2, PALETTE.leaf);
        dot(x + 1 + ((turn + 2) % 5), y - 2, PALETTE.leaf);
        dot(x + 3, y, PALETTE.frame);
      }
      if (tool === 'read') {
        // Leafing through papers, a page lifting now and then
        fill(s.x - 4, y + 1, 8, 2, PALETTE.paper);
        if (Math.floor(now * 2 + occupant.look.phase * 2) % 2 === 0) fill(s.x - 3, y, 6, 1, PALETTE.paper);
        dot(s.x - 5, y + 2, skin);
        dot(s.x + 4, y + 2, skin);
      } else if (occupant.session.state === 'thinking') {
        // Typing: one hand, then the other.
        const beat = Math.floor(now * 8 + occupant.look.phase * 8) % 2;
        dot(s.x - 3, y + 1 + beat, skin);
        dot(s.x + 2, y + 2 - beat, skin);
      } else if (occupant.session.state === 'unread') {
        // A coffee, now it's done.
        fill(s.x + 7, y - 1, 3, 3, PALETTE.mug);
        dot(s.x + 10, y, PALETTE.mug);
        const rise = (now * 0.6 + occupant.look.phase) % 1;
        dot(s.x + 8, y - 2 - Math.round(rise * 4), WHITE, 0.6 * (1 - rise));
      } else {
        dot(s.x - 3, y + 2, skin);
        dot(s.x + 2, y + 2, skin);
      }
    }

    function drawChair(desk) {
      const s = seat(desk), y = DESKS[desk].y;
      // A rounded back, lower than the monitor beside it
      fill(s.x - 3, y - 7, 7, 1, PALETTE.chairTop);
      fill(s.x - 4, y - 6, 9, 6, PALETTE.chair);
      fill(s.x - 4, y - 6, 1, 6, PALETTE.chairTop);
    }

    function drawCounter() {
      fill(230, 33, 26, 2, PALETTE.counterTop);
      fill(230, 35, 26, 12, PALETTE.counter);
      fill(232, 37, 10, 8, PALETTE.doorPanel);
      fill(244, 37, 10, 8, PALETTE.doorPanel);
      // The coffee machine, a cup under it, and a stack of cups
      fill(235, 22, 9, 11, PALETTE.machine);
      fill(236, 23, 7, 3, 0x3a3a40);
      dot(242, 24, 0x6fd36f);
      dot(239, 27, 0x3a3a40);
      fill(238, 30, 3, 3, PALETTE.mug);
      fill(248, 29, 3, 4, PALETTE.mug);
      const rise = (now * 0.5) % 1;
      dot(239 + Math.round(Math.sin(rise * 6) * 0.8), 29 - Math.round(rise * 6), WHITE, 0.5 * (1 - rise));
    }

    function drawCooler() {
      fill(306, 19, 4, 1, 0x6fa6d0);
      fill(305, 20, 6, 8, PALETTE.water);
      fill(303, 28, 10, 20, PALETTE.cooler);
      fill(304, 31, 2, 2, 0xd04a4a);
      fill(310, 31, 2, 2, 0x4a7ad0);
      fill(303, 48, 10, 1, SHADOW);
    }

    function drawCouchBack() {
      fill(250, 102, 52, 3, PALETTE.couchLight);
      fill(250, 105, 52, 7, PALETTE.couch);
      fill(267, 105, 1, 7, PALETTE.couchDark);
      fill(285, 105, 1, 7, PALETTE.couchDark);
      fill(250, 112, 52, 2, PALETTE.couchLight);
    }

    /** The seat's front and the arms, which hide the legs of whoever sits. */
    function drawCouchFront() {
      fill(250, 114, 52, 6, PALETTE.couchDark);
      fill(246, 104, 5, 16, PALETTE.couch);
      fill(301, 104, 5, 16, PALETTE.couch);
      fill(246, 104, 5, 1, PALETTE.couchLight);
      fill(301, 104, 5, 1, PALETTE.couchLight);
      fill(247, 120, 58, 1, SHADOW);
    }

    function drawCoffeeTable() {
      fill(264, 128, 24, 4, PALETTE.deskTop);
      fill(264, 132, 24, 2, PALETTE.deskFront);
      fill(265, 134, 1, 2, PALETTE.handle);
      fill(286, 134, 1, 2, PALETTE.handle);
      fill(270, 127, 2, 2, PALETTE.mug);
      fill(278, 129, 5, 2, PALETTE.paper);
    }

    /* The lounge's corner piece, as set up, and whoever is at it */

    const atCorner = (i) => office.people.some((p) => p.place === spotPlace(LOUNGE_SPOTS.length + i) && !p.isWalking && !p.isLeaving);

    /** An arcade cabinet: invaders march across its screen, and a ship fires back while someone plays. */
    function drawArcade() {
      const l = 265, playing = atCorner(0);
      fill(l - 1, 86, 16, 1, SHADOW);
      fill(l, 60, 14, 26, 0x2b2350);
      fill(l, 60, 1, 26, 0x8a5cf0);
      fill(l + 13, 60, 1, 26, 0x8a5cf0);
      fill(l + 1, 61, 12, 4, 0x6a3fb5);
      fill(l + 3, 62, 8, 2, 0xffd36b, 0.6 + 0.4 * Math.sin(now * 4));
      fill(l + 2, 66, 10, 9, PALETTE.doorway);
      fill(l + 3, 67, 8, 7, playing ? 0x14204a : 0x0b1022);
      const march = Math.floor(now * 2) % 4;
      for (let i = 0; i < 3; i++) dot(l + 4 + i * 2 + (march < 2 ? 0 : 1), 68 + (march % 2), 0x6fd36f);
      if (playing) {
        const ship = l + 4 + Math.round((Math.sin(now * 2.5) + 1) * 2.5);
        dot(ship, 73, WHITE);
        const shot = (now * 2.5) % 1;
        dot(ship, 72 - Math.round(shot * 4), 0xffd36b, 1 - shot * 0.5);
      }
      fill(l + 1, 75, 12, 3, 0x3d3470);
      fill(l + 4, 74, 1, 2, PALETTE.frame);
      dot(l + 4, 73, 0xd4140b);
      dot(l + 8, 76, 0xf2d35b);
      dot(l + 10, 76, 0x4c8bf5);
      fill(l + 5, 80, 4, 2, PALETTE.frame);
      dot(l + 6, 80, 0xd96a5a);
    }

    /** A vending machine, lit up: a snack drops now and then for whoever is at it. */
    function drawVending() {
      const l = 263;
      fill(l - 1, 86, 20, 1, SHADOW);
      fill(l, 58, 18, 28, 0xb8322a);
      fill(l, 58, 18, 2, 0xd9493f);
      fill(l + 2, 61, 11, 17, 0x9fd3e8);
      const snacks = [0xf2d35b, 0xd96a5a, 0x4f9a5a, 0x4c8bf5, 0xe08a3a, 0x9a6ad0];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) fill(l + 3 + c * 4, 62 + r * 4, 2, 2, snacks[(r * 4 + c * 5) % snacks.length]);
        fill(l + 2, 64 + r * 4, 11, 1, 0x7fb3c8);
      }
      fill(l + 2, 61, 2, 17, WHITE, 0.2);
      fill(l + 14, 61, 3, 9, PALETTE.machine);
      for (let r = 0; r < 3; r++) dot(l + 15, 62 + r * 2, r === 0 ? 0x6fd36f : PALETTE.keys);
      fill(l + 14, 72, 3, 2, PALETTE.frame);
      fill(l + 2, 80, 11, 4, PALETTE.frame);
      const fall = (now % 3) / 1.2;
      if (atCorner(0) && fall < 1) fill(l + 7, 62 + Math.round(fall * 18), 2, 2, 0xf2d35b);
    }

    /** A foosball table: its men twitch while someone's at it, and a match starts when both sides are taken. */
    function drawFoosball() {
      const busy = atCorner(0) || atCorner(1), match = atCorner(0) && atCorner(1);
      fill(255, 90, 34, 1, SHADOW);
      fill(257, 90, 2, 5, PALETTE.tableLeg);
      fill(285, 90, 2, 5, PALETTE.tableLeg);
      fill(256, 78, 32, 12, PALETTE.counter);
      fill(258, 80, 28, 8, 0x2f7a4a);
      fill(271, 80, 1, 8, WHITE, 0.5);
      fill(257, 82, 1, 4, PALETTE.frame);
      fill(286, 82, 1, 4, PALETTE.frame);
      [261, 265, 269, 274, 278, 282].forEach((x, i) => {
        fill(x, 76, 1, 16, 0xc9c3b8);
        fill(x, 75, 1, 2, PALETTE.frame);
        fill(x, 91, 1, 2, PALETTE.frame);
        const shift = busy ? Math.round(Math.sin(now * 5 + i * 1.7)) : 0;
        for (const y of [81, 85]) fill(x, y + shift, 1, 2, i % 2 ? 0x4c8bf5 : 0xd96a5a);
      });
      if (!match) return;
      const lap = (now * 0.8) % 2, across = lap < 1 ? lap : 2 - lap;
      dot(260 + Math.round(across * 24), 83 + Math.round(Math.sin(now * 3)), WHITE);
    }

    /** A fish tank on a cabinet: fish swim to and fro, and bubbles rise. */
    function drawFishTank() {
      fill(257, 86, 31, 1, SHADOW);
      fill(258, 76, 29, 10, PALETTE.counter);
      fill(260, 78, 11, 6, PALETTE.doorPanel);
      fill(274, 78, 11, 6, PALETTE.doorPanel);
      fill(258, 60, 29, 1, PALETTE.monitorOn);
      fill(258, 61, 29, 15, PALETTE.frame);
      fill(259, 62, 27, 13, 0x2f7fb0);
      fill(259, 62, 27, 2, 0x6fb6e0);
      fill(259, 72, 27, 3, 0xd9c38a);
      fill(262, 66, 1, 6, PALETTE.leaf);
      fill(263, 68, 1, 4, PALETTE.leafDark);
      fill(282, 67, 1, 5, PALETTE.leaf);
      for (const [speed, phase, y, colour] of [[0.13, 0, 66, 0xff8a3d], [0.09, 0.6, 69, 0xf2d35b], [0.17, 1.3, 64, 0xf28fb0]]) {
        const swim = (now * speed + phase) % 2, across = swim < 1 ? swim : 2 - swim, right = swim < 1;
        const x = 261 + Math.round(across * 20);
        fill(x, y, 3, 2, colour);
        dot(right ? x - 1 : x + 3, y, colour);
        dot(right ? x - 1 : x + 3, y + 1, colour);
        dot(right ? x + 2 : x, y, PALETTE.eye);
      }
      const rise = (now * 0.6) % 1;
      dot(284, 71 - Math.round(rise * 8), WHITE, 0.7 * (1 - rise));
      dot(283, 71 - Math.round(((rise + 0.5) % 1) * 8), WHITE, 0.5);
    }

    /** A bookcase, and a beanbag to read in, drawn round whoever sits in it. */
    function drawBookcase() {
      fill(287, 86, 21, 1, SHADOW);
      fill(288, 57, 19, 29, PALETTE.counter);
      [59, 66, 73, 80].forEach((y, row) => drawBooks(289, y, 17, row));
    }

    function drawBeanbagBack() {
      fill(266, 87, 16, 6, 0xc0584a);
      fill(268, 86, 12, 1, 0xd96a5a);
    }

    function drawBeanbagFront() {
      fill(265, 92, 18, 4, 0xd96a5a);
      fill(266, 96, 16, 1, 0xa84a3e);
      fill(265, 97, 18, 1, SHADOW);
    }

    /** What the lounge's corner piece is made of, each part at the depth it stands at. */
    const CORNER_PARTS = {
      arcade: [[86, drawArcade]], vending: [[86, drawVending]], foosball: [[89, drawFoosball]], fishtank: [[86, drawFishTank]],
      books: [[86, drawBookcase], [90, drawBeanbagBack], [94.5, drawBeanbagFront]], none: [],
    };

    /** A rally starts whenever both ends of the table are taken. */
    function drawPingPong() {
      fill(246, 148, 46, 9, PALETTE.table);
      fill(246, 148, 46, 1, PALETTE.tableLine);
      fill(246, 156, 46, 1, PALETTE.tableLine);
      fill(246, 148, 1, 9, PALETTE.tableLine);
      fill(291, 148, 1, 9, PALETTE.tableLine);
      fill(246, 152, 46, 1, PALETTE.tableLine, 0.6);
      fill(268, 146, 2, 11, PALETTE.frame);
      fill(246, 157, 46, 1, PALETTE.tableLeg);
      fill(248, 157, 2, 5, PALETTE.tableLeg);
      fill(288, 157, 2, 5, PALETTE.tableLeg);

      const players = PING_PONG.filter((spot) =>
        office.people.some((p) => p.place === spotPlace(spot) && !p.isWalking && !p.isLeaving));
      if (players.length !== 2) return;
      const lap = (now * 0.9) % 2;
      const across = lap < 1 ? lap : 2 - lap;
      dot(249 + Math.round(across * 40), 151 - Math.round(Math.abs(Math.sin(across * Math.PI * 2)) * 4), WHITE);
    }

    function drawPlant() {
      const x = PLANT_X;
      fill(x, 158, 4, 6, PALETTE.leaf);
      fill(x + 4, 154, 4, 10, PALETTE.leafDark);
      fill(x + 7, 159, 4, 6, PALETTE.leaf);
      fill(x + 2, 162, 7, 6, PALETTE.leaf);
      fill(x + 2, 168, 7, 8, PALETTE.pot);
      fill(x + 1, 168, 9, 1, 0x8a4f32);
      fill(x + 2, 176, 7, 1, SHADOW);
    }

    /**
     * The office's microphone, on a stand: the deck's 🎙. Its on-air light
     * glows while it's held; with no voice input in the picked session, it's
     * dimmed.
     */
    function drawMic() {
      const x = MIC.x + wobble('mic'), y = MIC.y;
      const a = mic.usable ? 1 : 0.4;
      fill(x - 4, y, 9, 1, SHADOW);
      fill(x - 3, y - 1, 7, 1, PALETTE.machine, a);
      fill(x - 1, y - 2, 3, 1, PALETTE.machine, a);
      fill(x, y - 17, 1, 15, PALETTE.monitorStand, a);
      if (decor.mic === 'megaphone') {
        // A megaphone on the stand, its horn to the room, a red rim on its mouth
        fill(x - 1, y - 22, 4, 5, MEGAPHONE, a);
        fill(x + 2, y - 22, 1, 5, PALETTE.dome, a);
        fill(x, y - 18, 2, 2, PALETTE.machine, a);
        for (let k = 1; k <= 6; k++) {
          const half = 2 + Math.floor(k / 2);
          fill(x - 1 - k, y - 20 - half, 1, half * 2 + 1, k === 6 ? PALETTE.dome : MEGAPHONE, a);
        }
        fill(x - 6, y - 23, 4, 1, WHITE, 0.5 * a);
      } else {
        // The head: a grille in a rounded case
        fill(x - 1, y - 24, 3, 1, PALETTE.sill, a);
        fill(x - 2, y - 23, 5, 5, PALETTE.sill, a);
        for (const row of [-22, -20]) fill(x - 1, y + row, 3, 1, PALETTE.monitor, a);
        fill(x - 1, y - 18, 3, 1, PALETTE.monitorStand, a);
      }
      // The on-air light, on the stand's clip
      fill(x - 1, y - 15, 3, 2, PALETTE.frame, a);
      if (mic.held) {
        fill(x - 2, y - 16, 5, 3, PALETTE.alarm, 0.3);
        fill(x - 1, y - 17, 3, 5, PALETTE.alarm, 0.3);
        fill(x, y - 15, 1, 1, PALETTE.alarm);
      } else {
        fill(x, y - 15, 1, 1, PALETTE.alarmOff, a);
      }
    }

    /**
     * The nuclear button: a red dome on a post in hazard stripes, like the
     * ☢ Max button on the deck. The dome sinks while it's pressed.
     */
    function drawButton() {
      const x = BUTTON.x + wobble('button'), y = BUTTON.y;
      const pressedAt = office.nuclearQueue[0] ? office.nuclearQueue[0].pressedAt : null;
      const sink = frame.buttonDown || (pressedAt !== null && now - pressedAt < 0.5) ? 1 : 0;
      for (let row = 0; row < 9; row++) {
        for (let column = 0; column < 11; column++) {
          dot(x - 5 + column, y + 6 + row, Math.floor((column + row) / 2) % 2 === 0 ? PALETTE.hazard : PALETTE.machine);
        }
      }
      fill(x - 7, y + 15, 15, 1, PALETTE.frame);
      fill(x - 7, y + 16, 15, 1, SHADOW);
      fill(x - 6, y + 4, 13, 2, PALETTE.machine);
      fill(x - 2, y + sink, 5, 1, PALETTE.domeLight);
      fill(x - 3, y + 1 + sink, 7, 3 - sink, PALETTE.dome);
      dot(x - 2, y + 1 + sink, PALETTE.domeLight);
      if (sink === 0) fill(x - 3, y + 3, 7, 1, PALETTE.domeDark);
    }

    /* People */

    /** The one the mic talks to: while it's held, and for the nod once it's let go. */
    const isListener = (person) => !person.isStaff && person.session.id === mic.listener;

    /**
     * A person is 17 art pixels tall, standing: two rows of hair, five of
     * face, six of shirt, a belt, two of legs and a row of shoes.
     */
    function drawPerson(person) {
      const pose = poseOf(person, now);
      const x = Math.round(person.position.x);
      // The listener nods, twice, once the mic is let go.
      const since = mic.releasedAt === null ? Infinity : now - mic.releasedAt;
      const nod = isListener(person) && since < NOD_LENGTH && Math.floor((since / NOD_LENGTH) * 4) % 2 === 0 ? 1 : 0;
      const top = topOf(person, pose) + nod;
      const { look } = person, away = person.isFacingAway;
      const shirtColour = person.isStaff ? STAFF_SHIRTS[Math.floor(look.phase * STAFF_SHIRTS.length) % STAFF_SHIRTS.length]
        : SHIRTS[person.session.agent] ?? SHIRTS.claude;
      const sleeve = (px, py, w, h) => {
        ctx.fillStyle = css(shirtColour, 1, 0.78);
        ctx.fillRect(ox + px * scale, oy + py * scale, w * scale, h * scale);
      };

      // Legs, for anyone not sitting down
      if (pose.kind !== 'sit' && pose.kind !== 'slump') {
        const lift = pose.kind === 'walk' ? (pose.step === 0 ? [1, 0] : [0, 1]) : pose.kind === 'tap' ? [0, pose.beat] : [0, 0];
        fill(x - 3, top + 17, 7, 1, SHADOW);
        fill(x - 3, top + 13, 7, 1, PALETTE.pants);
        fill(x - 2, top + 14 - lift[0], 2, 2, PALETTE.pants);
        fill(x + 1, top + 14 - lift[1], 2, 2, PALETTE.pants);
        fill(x - 2, top + 16 - lift[0], 2, 1, PALETTE.shoes);
        fill(x + 1, top + 16 - lift[1], 2, 1, PALETTE.shoes);
      }

      // Shirt and arms
      fill(x - 3, top + 7, 7, 6, shirtColour);
      if (pose.kind === 'wave') {
        sleeve(x - 4, top + 8, 1, 4);
        dot(x - 4, top + 12, look.skin);
        sleeve(x + 4, top + 4, 1, 4);
        dot(x + 4 + pose.frame, top + 3, look.skin);
      } else if (pose.kind === 'slump') {
        sleeve(x - 4, top + 6, 1, 3);
        sleeve(x + 4, top + 6, 1, 3);
      } else if (pose.kind === 'write') {
        // Back to us, writing on the whiteboard
        sleeve(x - 4, top + 8, 1, 4);
        dot(x - 4, top + 12, look.skin);
        sleeve(x + 4, top + 3, 1, 5);
        dot(x + 4 + pose.stroke, top + 2, look.skin);
      } else if (pose.kind === 'shred') {
        // Feeding a sheet into the shredder on their left
        const feed = (now * 1.2 + look.phase) % 1;
        sleeve(x - 4, top + 8, 1, 2);
        sleeve(x - 5, top + 9, 1, 1);
        dot(x - 6, top + 10, look.skin);
        fill(x - 9, top + 8 + Math.round(feed * 2), 3, 2, PALETTE.paper);
        sleeve(x + 4, top + 8, 1, 4);
        dot(x + 4, top + 12, look.skin);
      } else if (pose.kind === 'press') {
        // Hand high, then down on the dome
        sleeve(x - 4, top + 8, 1, 4);
        dot(x - 4, top + 12, look.skin);
        if (pose.raised) {
          sleeve(x + 4, top + 5, 1, 3);
          sleeve(x + 5, top + 3, 1, 2);
          fill(x + 5, top + 1, 1, 2, look.skin);
        } else {
          sleeve(x + 4, top + 8, 1, 2);
          sleeve(x + 5, top + 10, 1, 2);
          sleeve(x + 6, top + 12, 1, 1);
          fill(x + 7, top + 13, 1, 2, look.skin);
        }
      } else {
        sleeve(x - 4, top + 8, 1, 4);
        sleeve(x + 4, top + 8, 1, 4);
        dot(x - 4, top + 12, look.skin);
        dot(x + 4, top + 12, look.skin);
      }

      // Head: a face, or the back of it
      fill(x - 3, top + 2, 7, 5, away ? look.hair : look.skin);
      if (away) fill(x - 2, top + 6, 5, 1, look.skin);
      fill(x - 2, top, 5, 1, look.hair);
      fill(x - 3, top + 1, 7, 1, look.hair);
      dot(x - 3, top + 2, look.hair);
      dot(x + 3, top + 2, look.hair);
      if (look.hairStyle === 'long') {
        fill(x - 3, top + 2, 1, 7, look.hair);
        fill(x + 3, top + 2, 1, 7, look.hair);
      } else if (look.hairStyle === 'spiky') {
        for (const dx of [-2, 0, 2]) dot(x + dx, top - 1, look.hair);
      } else if (look.hairStyle === 'bun') {
        fill(x - 1, top - 2, 3, 2, look.hair);
      }

      if (away) return;
      const blinking = (now + look.phase * 5) % 4.5 < 0.15;
      // While the mic is held its listener looks toward it, and when it goes
      // on, everyone looks up for a moment.
      if (isListener(person) && mic.held && pose.kind !== 'slump') {
        dot(x - 1, top + 4, PALETTE.eye);
        dot(x + 3, top + 4, PALETTE.eye);
      } else if ((lookingUp || pose.kind === 'tap') && pose.kind !== 'slump') {
        dot(x - 2, top + 3, PALETTE.eye);
        dot(x + 2, top + 3, PALETTE.eye);
      } else if (pose.kind === 'slump') {
        // Eyes shut, head in hands
        dot(x - 2, top + 4, PALETTE.eye, 0.45);
        dot(x + 2, top + 4, PALETTE.eye, 0.45);
        fill(x - 4, top + 3, 1, 3, look.skin);
        fill(x + 4, top + 3, 1, 3, look.skin);
      } else if (pose.kind === 'wave' || pose.kind === 'press') {
        dot(x - 2, top + 4, PALETTE.eye);
        dot(x + 2, top + 4, PALETTE.eye);
        dot(x, top + 6, PALETTE.eye);
      } else if (!blinking) {
        dot(x - 2, top + 4, PALETTE.eye);
        dot(x + 2, top + 4, PALETTE.eye);
      }
    }

    /* Above the floor */

    /**
     * A white flash, the room going red, a shockwave across the floor, and
     * the warning light turning until the alarm stops.
     */
    function drawDetonation() {
      if (alarm === null) return;
      const since = alarm;
      const fade = Math.min(1, (ALARM_LENGTH - since) / 0.5);
      const all = (color, alpha) => fill(seen.left, seen.top, seen.width, seen.height, color, alpha);
      if (since < 0.08) all(WHITE, 0.5);
      if (since < FLASH_LENGTH) all(PALETTE.alarm, 0.35 * (1 - since / FLASH_LENGTH));
      all(PALETTE.alarm, 0.07 * (0.5 + 0.5 * Math.sin(since * 12)) * fade);

      // Two rings, flattened onto the floor
      for (const delay of [0, 0.15]) {
        const age = (since - delay) / SHOCKWAVE_LENGTH;
        if (age < 0 || age >= 1) continue;
        const radius = 3 + age * 150;
        const count = Math.floor(radius * 4);
        for (let k = 0; k < count; k++) {
          const angle = (k / count) * 2 * Math.PI;
          dot(Math.round(BUTTON.x + Math.cos(angle) * radius), Math.round(BUTTON.y + Math.sin(angle) * radius * 0.55),
            PALETTE.shockwave, 1 - age);
        }
      }

      // The warning light's beam, swinging from side to side
      const side = Math.floor(since * 6) % 2 === 0 ? -1 : 1;
      for (const [reach, spread] of [[10, 2], [20, 4], [32, 6]]) {
        fill(side < 0 ? 196 - reach : 201, 25 - spread, reach, spread * 2, PALETTE.alarm, 0.12 * fade);
      }
    }

    /** Each screen lights its edges in its session's colour, the same as its key on the deck. */
    function drawScreenLight(desk) {
      const session = sessionAt(desk);
      if (!session) return;
      const { x, y } = DESKS[desk];
      const blinkedOff = session.state === 'asking' && Math.floor(now * 2) % 2 === 1;
      // A command running turns the screen terminal-green.
      const shell = session.state === 'thinking' && toolKind(session.tool) === 'shell';
      const light = shell ? PALETTE.terminal
        : session.state === 'idle' || blinkedOff ? PALETTE.monitorOn : colour(session.state);

      if (session.state !== 'idle') fill(x + 3, y - 13, 19, 14, light, 0.12);
      fill(x + 5, y - 11, 15, 1, light);
      fill(x + 5, y - 10, 1, 9, light);
      fill(x + 19, y - 10, 1, 9, light);

      if (shell) {
        // Lines of output, scrolling up
        for (let k = 0; k < 4; k++) {
          const rise = (now * 1.4 + k / 4) % 1;
          fill(x + 7 + (k % 2) * 2, y - 12 - Math.round(rise * 9), 5 + (k % 3) * 2, 1, light, 1 - rise);
        }
      } else if (session.state === 'thinking') {
        for (let k = 0; k < 3; k++) {
          const rise = (now * 0.8 + k / 3 + desk * 0.17) % 1;
          dot(x + 8 + k * 4, y - 12 - Math.round(rise * 9), light, 1 - rise);
        }
      } else if (session.state === 'error') {
        for (let k = 0; k < 3; k++) {
          const rise = (now * 0.5 + k / 3) % 1;
          const size = rise > 0.5 ? 3 : 2;
          const drift = Math.round(Math.sin(rise * 6 + k) * 1.5);
          fill(x + 9 + k * 2 + drift, y - 13 - Math.round(rise * 12), size, size, PALETTE.smoke, 0.8 * (1 - rise));
        }
      }
    }

    function drawBubble(person) {
      // Going nuclear says enough on its own, and the choice keys stand in
      // for the bubble of the agent they answer.
      if (person.isLeaving || person.isGoingNuclear) return;
      if (frame.choices && !person.isStaff && person.session.id === selected) return;
      const state = person.session.state;
      const pose = poseOf(person, now);
      const x = Math.round(person.position.x), top = topOf(person, pose);

      if (mic.held && isListener(person)) {
        // Listening: sound lines coming in from the right.
        const bottom = top - 3;
        fill(x - 4, bottom - 7, 9, 9, PALETTE.bubbleEdge);
        fill(x - 5, bottom - 6, 11, 7, PALETTE.bubbleEdge);
        fill(x - 4, bottom - 6, 9, 7, PALETTE.bubble);
        dot(x - 1, bottom + 1, PALETTE.bubble);
        dot(x - 1, bottom + 2, PALETTE.bubbleEdge);
        const lit = Math.floor(now * 4) % 3;
        for (let k = 0; k <= lit; k++) {
          const lx = x - 2 + k * 2;
          fill(lx, bottom - 4 - k, 1, 3 + k * 2, PALETTE.bubbleEdge);
        }
        return;
      }

      if (state === 'idle') {
        // A nap, after a while on the couch
        const spot = spotOf(person.place);
        if (person.isWalking || spot === null || spots[spot].pose !== 'sit' || now - person.arrivedAt <= 20) return;
        const rise = (now * 0.35 + person.look.phase) % 1;
        const zx = x + 3 + Math.round(rise * 3), zy = top - 3 - Math.round(rise * 8);
        fill(zx, zy, 3, 1, WHITE, 1 - rise);
        dot(zx + 1, zy + 1, WHITE, 1 - rise);
        fill(zx, zy + 2, 3, 1, WHITE, 1 - rise);
        return;
      }

      const bob = state === 'asking' && Math.floor(now * 3) % 2 === 0 ? -1 : 0;
      const bottom = top - 3 + bob;
      fill(x - 4, bottom - 7, 9, 9, PALETTE.bubbleEdge);
      fill(x - 5, bottom - 6, 11, 7, PALETTE.bubbleEdge);
      fill(x - 4, bottom - 6, 9, 7, PALETTE.bubble);
      dot(x - 1, bottom + 1, PALETTE.bubble);
      dot(x - 1, bottom + 2, PALETTE.bubbleEdge);

      // A 5 × 5 mark in the middle, in the state's colour
      const marks = {
        asking: [[0, 0], [0, 1], [0, 2], [0, 4]],
        unread: [[-2, 2], [-1, 3], [0, 2], [1, 1], [2, 0]],
        error: [[-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2], [-1, 3], [1, 3], [-2, 4], [2, 4]],
      };
      const cells = state === 'thinking'
        ? Array.from({ length: Math.floor(now * 3 + person.look.phase * 3) % 4 }, (_, i) => [-2 + i * 2, 2])
        : marks[state] || [];
      for (const [column, row] of cells) dot(x + column, bottom - 5 + row, colour(state));
    }

    /**
     * The project's name under each desk, with its state's colour beside it,
     * and under it, what the agent is doing, tinted with that colour. A key
     * pinned to a project with nothing running keeps its name, dimmed.
     *
     * Where the text is bigger than the art, as on a phone, only the picked
     * desk says what its agent is doing: every desk's would cover the row
     * below.
     */
    function drawLabel(desk) {
      if (desk >= office.seats.length) return;
      const s = office.seats[desk];
      const name = s.session ? s.session.name : s.pin;
      if (!name) return;

      const roomy = LABEL_SIZE * scale >= LABEL_SMALLEST * ratio;
      const size = roomy ? LABEL_SIZE * scale : LABEL_SMALLEST * ratio;
      const font = (weight, px) => `${weight} ${px}px ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif`;
      ctx.font = font(600, size);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const dotSize = s.session ? size * 0.55 : 0;
      const gap = s.session ? size * 0.4 : 0;
      const padding = size * 0.5;
      // Cut to the space between desks, so labels never run into each other.
      const room = (DESK_COLUMNS[1] - DESK_COLUMNS[0] - 2) * scale - dotSize - gap - padding * 2;
      const shown = fitText(ctx, name, room);
      const nameWidth = ctx.measureText(shown).width + dotSize + gap + padding * 2;

      const activity = s.session && s.session.activity && (roomy || desk === selectedDesk) ? s.session.activity : null;
      const small = size * 0.82;
      let doing = '', doingWidth = 0;
      if (activity) {
        ctx.font = font(500, small);
        doing = fitText(ctx, activity, DESK_WIDTH * scale - padding * 2);
        doingWidth = ctx.measureText(doing).width + padding * 2;
      }

      const center = screen(DESKS[desk].x + DESK_WIDTH / 2, DESKS[desk].y + 20.5);
      const h = size * 1.25, extra = activity ? small * 1.4 : 0;
      const w = Math.max(nameWidth, doingWidth);
      const left = center.x - w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundedRect(ctx, left, center.y - h / 2, w, h + extra, h / 2);
      ctx.fill();
      const nameLeft = center.x - nameWidth / 2;
      if (s.session) {
        ctx.fillStyle = css(colour(s.session.state));
        ctx.beginPath();
        ctx.arc(nameLeft + padding + dotSize / 2, center.y, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = font(600, size);
      ctx.fillStyle = `rgba(255,255,255,${s.session ? 0.92 : 0.45})`;
      ctx.fillText(shown, nameLeft + padding + dotSize + gap, center.y);
      if (activity) {
        ctx.font = font(500, small);
        ctx.fillStyle = css(colour(s.session.state));
        ctx.fillText(doing, center.x - doingWidth / 2 + padding, center.y + h / 2 + extra / 2 - small * 0.2);
      }
    }

    /** The shredder a compacting session's agent feeds, beside its desk. */
    function drawShredder(desk) {
      const { x, y } = DESKS[desk], sx = x + SHREDDER.dx;
      // The cutting head, its slot on top
      fill(sx, y + 8, 6, 1, PALETTE.shredderTop);
      fill(sx + 1, y + 8, 4, 1, PALETTE.frame);
      fill(sx, y + 9, 6, 2, PALETTE.shredder);
      // The bin under it, filling with strips, one falling
      fill(sx, y + 11, 6, 5, PALETTE.sill);
      for (const [dx, height] of [[1, 2], [2, 3], [4, 2]]) fill(sx + dx, y + 16 - height, 1, height, PALETTE.paper);
      dot(sx + 3, y + 11 + (Math.floor(now * 6) % 3), PALETTE.paper);
      fill(sx, y + 16, 6, 1, SHADOW);
    }

    /**
     * A subagent, as an intern: 13 art pixels tall, in their agent's colour,
     * with a badge.
     */
    function drawIntern(intern) {
      const x = Math.round(intern.position.x), feet = Math.round(intern.position.y), top = feet - 13;
      const { look } = intern, shirt = SHIRTS[intern.agent] ?? SHIRTS.claude;
      const step = intern.isWalking ? Math.floor(now * 7) % 2 : null;
      const lift = step === null ? [0, 0] : step === 0 ? [1, 0] : [0, 1];
      fill(x - 2, feet, 5, 1, SHADOW);
      fill(x - 2, top + 9, 5, 1, PALETTE.pants);
      fill(x - 1, top + 10 - lift[0], 1, 2, PALETTE.pants);
      fill(x + 1, top + 10 - lift[1], 1, 2, PALETTE.pants);
      dot(x - 1, top + 12 - lift[0], PALETTE.shoes);
      dot(x + 1, top + 12 - lift[1], PALETTE.shoes);
      fill(x - 2, top + 5, 5, 4, shirt);
      dot(x, top + 6, PALETTE.bubble);
      ctx.fillStyle = css(shirt, 1, 0.78);
      for (const side of [-3, 3]) ctx.fillRect(ox + (x + side) * scale, oy + (top + 6) * scale, scale, 2 * scale);
      dot(x - 3, top + 8, look.skin);
      dot(x + 3, top + 8, look.skin);
      fill(x - 2, top + 1, 5, 4, look.skin);
      fill(x - 1, top, 3, 1, look.hair);
      fill(x - 2, top + 1, 5, 1, look.hair);
      if ((now + look.phase * 5) % 4 >= 0.15) {
        dot(x - 1, top + 3, PALETTE.eye);
        dot(x + 1, top + 3, PALETTE.eye);
      }
    }

    /**
     * How long the turn has run, on the back of the monitor while the agent
     * works, and sweat once it's been a long one. Beside the desk, how many
     * interns are waiting for room round it.
     */
    function drawTimer(desk) {
      const { x, y } = DESKS[desk];
      const waiting = office.waitingAt(desk);
      if (waiting) pixelText(`+${waiting}`, x - 9, y - 16, PALETTE.bubble);

      const session = sessionAt(desk);
      if (!session || !session.turnStartedAt || (session.state !== 'thinking' && session.state !== 'asking')) return;
      const seconds = Math.max(0, Math.floor((Date.now() - session.turnStartedAt) / 1000));
      const text = turnLength(seconds);
      pixelText(text, x + 13 - Math.floor(pixelWidth(text) / 2), y - 8, PALETTE.bubble, false);

      const occupant = office.people.find((p) => p.desk === desk && p.isAtDesk);
      if (seconds < LONG_TURN || !occupant) return;
      const s = seat(desk), top = topOf(occupant, poseOf(occupant, now));
      const run = (now * 1.5 + occupant.look.phase) % 1;
      dot(s.x + 4, top + 2 + Math.round(run * 4), PALETTE.sweat, 1 - run * 0.6);
    }

    /**
     * The picked desk, as the deck marks its key: a pool of light on the
     * floor under it, and corners in the ink colour round it.
     */
    function drawSpotlight() {
      if (selectedDesk < 0) return;
      const { x, y } = DESKS[selectedDesk];
      for (const [grow, alpha] of [[0, 0.1], [3, 0.06]]) {
        fill(x - 4 - grow, y - 14 + grow / 2, DESK_WIDTH + 8 + grow * 2, 34 - grow, ink, alpha);
      }
    }

    function drawSelectionCorners() {
      if (selectedDesk < 0) return;
      const { x, y } = DESKS[selectedDesk];
      const left = x - 3, right = x + DESK_WIDTH + 2, top = y - 14, bottom = y + 18;
      for (const [cx, cy, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]]) {
        fill(dx > 0 ? cx : cx - 3, cy, 4, 1, ink);
        fill(cx, dy > 0 ? cy : cy - 3, 1, 4, ink);
      }
    }

    /** Sound waves from the mic while it's held, spreading across the room. */
    function drawMicWaves() {
      if (!mic.held) return;
      const heldFor = now - mic.heldAt;
      const mouth = decor.mic === 'megaphone' ? { x: MIC.x - 8, y: MIC.y - 20 } : { x: MIC.x, y: MIC.y - 21 };
      for (let k = 0; k < 3; k++) {
        const age = (heldFor - k * WAVE_EVERY) % (WAVE_EVERY * 3) / (WAVE_EVERY * 3);
        if (heldFor < k * WAVE_EVERY) continue;
        const radius = 6 + age * WAVE_REACH;
        const count = Math.floor(radius * 1.5);
        for (let i = 0; i <= count; i++) {
          // A quarter turn, out into the room from the corner
          const angle = Math.PI + (i / count) * (Math.PI / 2);
          dot(Math.round(mouth.x + Math.cos(angle) * radius), Math.round(mouth.y + Math.sin(angle) * radius * 0.8),
            PALETTE.alarm, 0.6 * (1 - age));
        }
      }
    }

    /**
     * The choice keys over the picked agent: dark keys on a speech bubble's
     * paper, each sinking a pixel while it's pressed.
     */
    function drawChoices() {
      const { left, top, w, h, tip, keys } = frame.choices;
      fill(left + 1, top, w - 2, h, PALETTE.bubbleEdge);
      fill(left, top + 1, w, h - 2, PALETTE.bubbleEdge);
      fill(left + 1, top + 1, w - 2, h - 2, PALETTE.bubble);
      // The tail, down to the agent's head
      fill(tip.x - 1, top + h - 1, 3, 1, PALETTE.bubble);
      dot(tip.x - 1, top + h, PALETTE.bubbleEdge);
      dot(tip.x, top + h, PALETTE.bubble);
      dot(tip.x + 1, top + h, PALETTE.bubbleEdge);
      dot(tip.x, tip.y, PALETTE.bubbleEdge);

      const down = frame.choiceDown;
      const marks = { up: PALETTE.bubble, down: PALETTE.bubble, accept: colour('unread'), reject: colour('error') };
      for (const { action, x, y } of keys) {
        const { w: kw, h: kh } = CHOICE_KEY;
        const sunk = down && down.action === action && (down.held || now - down.at < CHOICE_PRESS_LENGTH) ? 1 : 0;
        fill(x + 1, y, kw - 2, kh, PALETTE.frame);
        fill(x, y + 1, kw, kh - 2, PALETTE.frame);
        fill(x + 1, y + 1, kw - 2, kh - 2, PALETTE.wainscot);
        fill(x + 1, y + 1 + sunk, kw - 2, kh - 4, PALETTE.rail);
        fill(x + 2, y + 1 + sunk, kw - 4, 1, PALETTE.monitorOn);
        const rows = CHOICE_MARKS[action];
        const mx = x + Math.floor((kw - rows[0].length) / 2), my = y + 1 + sunk + Math.floor((kh - 4 - rows.length) / 2);
        rows.forEach((row, r) => [...row].forEach((on, column) => { if (on === '1') dot(mx + column, my + r, marks[action]); }));
      }
    }

    /**
     * The paint chips on the picked desk: the effort it's set to stands
     * proud in a white outline, a tapped chip sinks, and max carries the
     * red button's trefoil.
     */
    function drawChips() {
      const { left, top, w, h, chips } = frame.chips;
      const session = sessionAt(selectedDesk);
      fill(left - 1, top - 1, w + 2, h + 3, PALETTE.frame);
      fill(left - 1, top + h + 2, w + 2, 1, SHADOW);
      const down = frame.chipDown;
      for (const { level, x, y } of chips) {
        const paint = EFFORT_PAINT[level];
        const set = session && session.effort === level;
        const sunk = down && down.level === level && (down.held || now - down.at < CHOICE_PRESS_LENGTH) ? 1 : 0;
        // A chip is a face over a darker edge: the set one stands a pixel
        // proud, and a tapped one sinks flat.
        const face = y + sunk - (set && !sunk ? 1 : 0);
        fill(x, face + h - 1, CHIP.w, y - face + 1, darker(paint));
        fill(x, face, CHIP.w, h - 1, paint);
        fill(x, face, CHIP.w, 1, WHITE, 0.35);
        if (set) {
          fill(x, face, CHIP.w, 1, WHITE);
          fill(x, face + h - 2, CHIP.w, 1, WHITE);
          fill(x, face, 1, h - 1, WHITE);
          fill(x + CHIP.w - 1, face, 1, h - 1, WHITE);
        }
        if (level === 'max') {
          // The trefoil, in three dots round a fourth
          const cx = x + 5, cy = face + 4;
          for (const [dx, dy] of [[0, -2], [-2, 1], [2, 1], [0, 0]]) dot(cx + dx, cy + dy, PALETTE.domeDark);
        }
      }
    }

    /**
     * The window onto the room: rings of shadow from its edge inwards, each
     * fainter than the last, then the edge in the keys' colour.
     */
    function drawWindowFrame({ x, y, w, h, r }) {
      ctx.save();
      ctx.lineWidth = ratio;
      for (let ring = 0; ring < WINDOW_SHADOW; ring++) {
        const inset = (ring + 0.5) * ratio;
        ctx.strokeStyle = css(BLACK, WINDOW_SHADOW_DEPTH * (1 - ring / WINDOW_SHADOW) ** 2);
        roundedRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
        ctx.stroke();
      }
      ctx.strokeStyle = css(fromCss(office.colours.edge) ?? EDGE);
      roundedRect(ctx, x + ratio / 2, y + ratio / 2, w - ratio, h - ratio, r - ratio / 2);
      ctx.stroke();
      if (calling) {
        ctx.strokeStyle = css(colour('asking'), 0.35 + 0.65 * glow);
        ctx.lineWidth = 1.5 * ratio;
        roundedRect(ctx, x + ratio * 0.75, y + ratio * 0.75, w - ratio * 1.5, h - ratio * 1.5, r - ratio * 0.75);
        ctx.stroke();
      }
      ctx.restore();
    }

    /**
     * Under the floating window, before the room: a soft shadow, and while
     * anyone waits on you, the glow round it.
     */
    function drawFloat({ x, y, w, h, r }) {
      ctx.save();
      roundedRect(ctx, x, y, w, h, r);
      ctx.fillStyle = css(BLACK);
      ctx.shadowColor = css(BLACK, 0.55);
      ctx.shadowBlur = FLOAT_SHADOW * ratio;
      ctx.shadowOffsetY = FLOAT_DROP * ratio;
      ctx.fill();
      if (calling) {
        ctx.shadowColor = css(colour('asking'), 0.25 + 0.6 * glow);
        ctx.shadowBlur = GLOW_REACH * ratio;
        ctx.shadowOffsetY = 0;
        ctx.fill();
      }
      ctx.restore();
    }

    /* The frame, back to front */

    drawWall();
    drawFloor();
    drawSpotlight();

    // What stands on the floor, drawn in order of where it touches the
    // floor, so that nearer things cover farther ones.
    const items = [
      [46.5, drawCounter], [50, drawCooler], [110, drawCouchBack], [117, drawCouchFront],
      [134, drawCoffeeTable], [157, drawPingPong], [176, drawPlant], [176.5, drawButton], [177, drawMic],
      ...CORNER_PARTS[decor.corner],
    ];
    DESKS.forEach((d, desk) => {
      items.push([d.y + 5, () => drawDesk(desk)]);
      items.push([d.y + 3.5, () => drawChair(desk)]); // just behind whoever sits in it
    });
    for (const person of office.people) items.push([person.position.y, () => drawPerson(person)]);
    office.seats.forEach((s, desk) => { if (s.session && s.session.compacting) items.push([DESKS[desk].y + 16, () => drawShredder(desk)]); });
    for (const intern of office.interns) {
      // One still waiting for room hasn't come in yet.
      if (intern.slot !== null || intern.isLeaving) items.push([intern.position.y, () => drawIntern(intern)]);
    }
    items.sort((a, b) => a[0] - b[0]).forEach(([, draw]) => draw());

    if (isNight) fill(seen.left, seen.top, seen.width, seen.height, PALETTE.night, 0.3);
    drawSelectionCorners();
    drawDetonation();
    drawMicWaves();
    DESKS.forEach((_, desk) => drawScreenLight(desk));
    DESKS.forEach((_, desk) => drawTimer(desk));
    office.people.forEach(drawBubble);
    DESKS.forEach((_, desk) => drawLabel(desk));
    if (frame.chips) drawChips();
    if (frame.choices) drawChoices();

    if (glass) {
      ctx.restore();
      drawWindowFrame(glass);
    }
  }

  /** `text`, cut with an ellipsis to fit `room` pixels in the context's font. */
  function fitText(ctx, text, room) {
    if (ctx.measureText(text).width <= room) return text;
    let chars = [...text];
    while (chars.length > 1 && ctx.measureText(`${chars.join('')}…`).width > room) chars = chars.slice(0, -1);
    return `${chars.join('').trimEnd()}…`;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* --------------------------------------------------------- on the page */

  /** At most 30 frames a second: the art moves in whole pixels, and more would only spend battery. */
  const FRAME_TIME = 1000 / 30;
  /**
   * Out of sight this long, the room starts over from the latest snapshot
   * when it's seen again, everyone in place: nobody replays a press of ☢ Max
   * or a walk out that happened while nobody was looking.
   */
  const STALE_AFTER = 2000;

  /** The deck's snapshot, as the office reads it: a seat per key, its session if it has one. */
  function seatsOf(snapshot) {
    return (snapshot.keys || []).map((key) => ({
      pin: key.pin || null,
      session: key.session && {
        ...key.session,
        // Each project always gets the same face, whatever folder its agent is in.
        name: key.session.project || key.session.name || '',
        effort: key.session.effort || '',
        maxPressedAt: key.session.maxPressedAt ?? null,
      },
    }));
  }

  /** Nothing to tap is smaller than this, in CSS pixels, so a finger finds it. */
  const SMALLEST_TARGET = 44;

  function create(canvas, on = {}) {
    const ctx = canvas.getContext('2d');
    const office = new Office();
    const clock = () => performance.now() / 1000;
    let visible = true;
    let framed = false;  // seen through a window, beside the phone's controls
    let floating = null;  // floating in a 'window' of its own or a whole 'screen', or not
    let frame = null;
    let last = 0;
    let selected = null; // the session the deck's controls act on
    let latest = null;   // the deck's last snapshot
    // The mic: whether a finger holds it, when it last went on and off, and
    // who it talks to.
    const mic = { held: false, heldAt: null, releasedAt: null, listener: null, usable: true };
    let wobbling = null;     // the button or the mic, tapped with no desk picked: { what, at }
    let buttonDown = false;  // a finger on the nuclear button
    let choiceDown = null;   // the last choice key tapped: { action, at, held }
    let chipDown = null;     // the last paint chip tapped: { level, at, held }
    let chipsFor = null;     // the session whose chips are out, after a finger held on its desk
    let finger = null;       // the one finger on the room: { id }
    // The window the canvas is in, its page's or one it has moved to: the
    // room draws with that window's frames and pixels, and pauses only when
    // it's hidden. The page can be out of sight while that window is on top.
    let host = null;         // { window, resizing, seen }

    // The canvas holds the screen's own pixels, so the art can be scaled by
    // a whole number of them.
    function resize() {
      const ratio = host.window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      ctx.imageSmoothingEnabled = false;
    }

    /** Follows the window the canvas is in now: its size, and whether it can be seen. */
    function bind() {
      const win = canvas.ownerDocument.defaultView || window;
      if (host && host.window === win) return;
      unbind();
      const resizing = new win.ResizeObserver(resize);
      resizing.observe(canvas);
      const seen = () => {
        if (win.document.hidden && finger) lift();
        run();
      };
      win.document.addEventListener('visibilitychange', seen);
      host = { window: win, resizing, seen };
    }

    function unbind() {
      if (!host) return;
      if (frame !== null) host.window.cancelAnimationFrame(frame);
      frame = null;
      host.resizing.disconnect();
      host.window.document.removeEventListener('visibilitychange', host.seen);
      host = null;
    }

    function selectedSession() {
      const seat = office.seats.find((s) => s.session && s.session.id === selected);
      return seat ? seat.session : null;
    }

    /** The paint chips, once held out on the picked desk of an agent with an effort setting, while the dial is out of sight. */
    function chips() {
      if (framed || chipsFor === null || chipsFor !== selected) return null;
      const desk = office.seats.findIndex((s) => s.session && s.session.id === selected);
      return desk >= 0 && office.seats[desk].session.dial ? effortChips(desk) : null;
    }

    /** The choice keys, while the picked agent waits on you and the deck's own controls are out of sight. */
    function choices() {
      if (framed) return null;
      const desk = office.seats.findIndex((s) => s.session && s.session.id === selected);
      return desk >= 0 && office.seats[desk].session.state === 'asking' ? choicePanel(desk) : null;
    }

    function tick() {
      frame = null;
      if (!visible || host.window.document.hidden) return;
      frame = host.window.requestAnimationFrame(tick);
      // The page's clock, not the frame's: each window counts its frames'
      // time from when it opened, and the room can move between them.
      const time = performance.now();
      if (time - last < FRAME_TIME - 1) return;
      if (last && time - last > STALE_AFTER && latest) {
        office.close();
        office.apply(seatsOf(latest), latest.theme, time / 1000);
      }
      last = time;
      const now = time / 1000, date = new Date();
      // Dimmed only for a picked session with no voice input: with none
      // picked, a tap wobbles it and asks for a desk.
      const session = selectedSession();
      mic.usable = !session || !!session.mic;
      // A finger held on a desk, or its person, puts out its chips.
      if (finger && !finger.held && finger.target.kind === 'session' && now - finger.at >= HOLD_FOR_CHIPS) {
        finger.held = true;
        chipsFor = finger.target.id;
        if (chips()) on.held?.();
      }
      office.step(now);
      drawOffice(ctx, office, {
        now, hour: date.getHours(), minute: date.getMinutes(),
        width: canvas.width, height: canvas.height, ratio: host.window.devicePixelRatio || 1,
        selected, mic, wobble: wobbling, buttonDown, framed, floating, choices: choices(), choiceDown, chips: chips(), chipDown,
      });
    }

    function run() {
      if (frame === null && visible && !host.window.document.hidden) frame = host.window.requestAnimationFrame(tick);
    }

    /**
     * What's under a point on the page, if it can be tapped. Each target
     * reaches at least SMALLEST_TARGET round its middle; of those in reach,
     * the nearest wins, and on a tie choice keys come before people, people
     * before things, and things before desks. The choice keys' panel covers
     * what's under it: a tap on it goes to a key or nowhere.
     */
    function targetAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const ratio = host.window.devicePixelRatio || 1;
      const { scale, ox, oy } = fitRoom(canvas.width, canvas.height, floating ? FLOAT_MARGINS[floating] * ratio : 0);
      const x = ((clientX - rect.left) * (canvas.width / rect.width) - ox) / scale;
      const y = ((clientY - rect.top) * (canvas.height / rect.height) - oy) / scale;
      const reach = (SMALLEST_TARGET * ratio) / scale;
      const now = clock();
      let best = null;
      const consider = (target, box, rank) => {
        const grow = (low, high) => {
          const extra = Math.max(0, reach - (high - low)) / 2;
          return [low - extra, high + extra];
        };
        const [left, right] = grow(box.left, box.right), [top, bottom] = grow(box.top, box.bottom);
        if (x < left || x > right || y < top || y > bottom) return;
        const distance = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
        if (!best || distance < best.distance || (distance === best.distance && rank < best.rank)) best = { target, distance, rank };
      };

      for (const person of office.people) {
        if (person.isStaff || person.isLeaving) continue;
        const px = Math.round(person.position.x), top = topOf(person, poseOf(person, now));
        // The sprite, its arms, and the bubble over its head
        consider({ kind: 'session', id: person.session.id },
          { left: px - 5, right: px + 8, top: top - 11, bottom: Math.round(person.position.y) + 1 }, 0);
      }
      consider({ kind: 'button' }, { left: BUTTON.x - 7, right: BUTTON.x + 8, top: BUTTON.y - 1, bottom: BUTTON.y + 16 }, 1);
      consider({ kind: 'mic' }, { left: MIC.x - (decor.mic === 'megaphone' ? 9 : 5), right: MIC.x + 6, top: MIC.y - 25, bottom: MIC.y + 1 }, 1);
      office.seats.forEach((seat, desk) => {
        const target = seat.session ? { kind: 'session', id: seat.session.id } : seat.pin ? { kind: 'pinned', name: seat.pin } : null;
        // The desk, its chair and monitor, and its label
        const { x: dx, y: dy } = DESKS[desk];
        if (target) consider(target, { left: dx - 2, right: dx + DESK_WIDTH + 2, top: dy - 14, bottom: dy + 27 }, 2);
      });
      const strip = chips();
      if (strip) {
        for (const chip of strip.chips) {
          consider({ kind: 'chip', level: chip.level }, { left: chip.x, right: chip.x + CHIP.w, top: chip.y, bottom: chip.y + CHIP.h }, -1);
        }
        // A tap on the strip goes to a chip or nowhere, never to what's under it.
        const onStrip = x >= strip.left - 1 && x <= strip.left + strip.w + 1 && y >= strip.top - 1 && y <= strip.top + strip.h + 2;
        if (onStrip) return best && best.target.kind === 'chip' ? best.target : null;
      }
      const panel = choices();
      if (panel) {
        for (const key of panel.keys) {
          consider({ kind: 'choice', action: key.action },
            { left: key.x, right: key.x + CHOICE_KEY.w, top: key.y, bottom: key.y + CHOICE_KEY.h }, -1);
        }
        const onPanel = x >= panel.left && x <= panel.left + panel.w && y >= panel.top && y <= panel.tip.y;
        if (onPanel) return best && best.target.kind === 'choice' ? best.target : null;
      }
      return best && best.target;
    }

    /** Everything a key or button does on the deck, done by tapping the room. */
    function press(target) {
      // Anything else tapped puts the chips away.
      if (target.kind !== 'chip') chipsFor = null;
      if (target.kind === 'choice') {
        choiceDown = { action: target.action, at: clock(), held: true };
        return on.choose?.(target.action);
      }
      // Max from a chip is the red button's: its agent runs to slam it.
      if (target.kind === 'chip') {
        chipDown = { level: target.level, at: clock(), held: true };
        return target.level === 'max' ? on.max?.() : on.effort?.(target.level);
      }
      if (target.kind === 'session') return on.select?.(target.id);
      if (target.kind === 'pinned') return on.hint?.(`Nothing running in ${target.name}`);
      const session = selectedSession();
      if (!session) {
        wobbling = { what: target.kind, at: clock() };
        return on.hint?.('Pick a desk first');
      }
      // As the deck's ☢ Max and 🎙: only for an agent with an effort setting,
      // or with voice input.
      if (target.kind === 'button' && session.dial) {
        buttonDown = true;
        on.max?.();
      } else if (target.kind === 'mic' && session.mic) {
        Object.assign(mic, { held: true, heldAt: clock(), releasedAt: null, listener: session.id });
        on.mic?.('down');
      }
    }

    /** The finger lifts, or is taken away: the mic must always hear about it, or it keeps listening. */
    function lift() {
      // A chip, once chosen, goes away with the rest.
      if (finger && finger.target.kind === 'chip') chipsFor = null;
      finger = null;
      buttonDown = false;
      if (choiceDown) choiceDown.held = false;
      if (chipDown) chipDown.held = false;
      if (!mic.held) return;
      mic.held = false;
      mic.releasedAt = clock();
      on.mic?.('up');
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (finger) return; // one finger at a time
      const target = targetAt(e.clientX, e.clientY);
      if (!target) return;
      canvas.setPointerCapture(e.pointerId);
      finger = { id: e.pointerId, target, at: clock() };
      press(target);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => { if (finger && e.pointerId === finger.id) lift(); });
    }
    // A mouse shows what can be clicked.
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && !finger) canvas.style.cursor = targetAt(e.clientX, e.clientY) ? 'pointer' : '';
    });
    bind();
    resize();
    run();

    return {
      show(snapshot) {
        latest = snapshot;
        office.furnish(snapshot.layout && snapshot.layout.room);
        office.apply(seatsOf(snapshot), snapshot.theme, clock());
      },
      close() {
        latest = null;
        office.close();
      },
      select(id) { selected = id; },
      setVisible(shown) {
        visible = shown;
        if (shown) { resize(); run(); } else if (finger) lift();
      },
      setFramed(shown) { framed = shown; },
      /** Floats the room's window in a 'window' of its own or a whole 'screen', or stops, with null. */
      setFloating(how) { floating = how; },
      /**
       * The canvas is in another window now, or back on its page. Moving it
       * takes the finger off without a word to the canvas, so the mic is let
       * go here, however the move came about.
       */
      moved() {
        if (finger) lift();
        bind();
        resize();
        run();
      },
    };
  }

  /** The pop-out window's size, in CSS pixels: two to each of the room's, and the margin round it. */
  const popOutSize = { width: WIDTH * 2 + FLOAT_MARGINS.window * 2, height: HEIGHT * 2 + FLOAT_MARGINS.window * 2 };

  window.AgentOffice = { create, popOutSize };
})();
