/*
 * The Agent Office: the deck's sessions as people in a little pixel-art
 * office, for the phone's Office view and the /office page.
 *
 * Each key is a desk, in the same order, with a person at it who acts out
 * what their session is doing. Everything is drawn in code on a 320 × 180
 * grid of art pixels, scaled by a whole number of the screen's pixels so
 * every edge stays sharp.
 *
 *   AgentOffice.create(canvas) → { show(snapshot), close(), setVisible(on) }
 *
 * `show` takes what the deck streams; `close` empties the office when the
 * stream drops, and whoever is there when it's back is already at work.
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

  /** Where idle people spend their time. */
  const SPOTS = [
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

  // Where a person is, or is heading: 'desk:n', 'spot:n', 'door', 'button'
  // or 'queue', the spot beside it.
  const deskPlace = (desk) => `desk:${desk}`;
  const spotPlace = (spot) => `spot:${spot}`;
  const deskOf = (place) => (place.startsWith('desk:') ? Number(place.slice(5)) : null);
  const spotOf = (place) => (place.startsWith('spot:') ? Number(place.slice(5)) : null);

  function pointOf(place) {
    if (deskOf(place) !== null) return seat(deskOf(place));
    if (spotOf(place) !== null) return SPOTS[spotOf(place)];
    return { door: DOOR, button: PRESSER, queue: NEXT_IN_LINE }[place];
  }

  /**
   * The way from where someone stands to a place. Desks are reached along
   * the walkway behind their row, from the corridor; the lounge is open
   * floor, crossed in a straight line.
   */
  function route(from, place) {
    const target = pointOf(place);
    const desk = deskOf(place);
    const amongDesks = from.x < CORRIDOR_X - 1 && from.y > WALL_BOTTOM;
    const current = laneNearest(from.y);
    const path = [];
    if (desk !== null && amongDesks && lane(desk) === current) {
      path.push({ x: from.x, y: current });
    } else {
      if (amongDesks) path.push({ x: from.x, y: current }, { x: CORRIDOR_X, y: current });
      if (desk !== null) path.push({ x: CORRIDOR_X, y: lane(desk) });
      else if (place === 'door') path.push({ x: CORRIDOR_X, y: WALL_BOTTOM + 8 });
    }
    if (desk !== null) path.push({ x: target.x, y: lane(desk) });
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
  };
  const BLACK = 0x000000, WHITE = 0xffffff;
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
      this.pressedAt = null;
      this.isFacingAway = false;
      this.nextMove = Infinity; // when an idle person next decides where to go
      this.arrivedAt = 0;
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
    }

    apply(seats, colours, now) {
      this.seats = seats.slice(0, DESKS.length);
      this.colours = colours || {};

      const current = new Map();
      this.seats.forEach((s, desk) => { if (s.session) current.set(s.session.id, { desk, session: s.session }); });
      const known = new Set(this.people.map((p) => p.session.id));
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
          member.position = { x: SPOTS[spot].x, y: SPOTS[spot].y };
          member.isFacingAway = SPOTS[spot].pose === 'away';
          member.arrivedAt = now - random(0, 20);
          member.nextMove = now + random(5, 25);
        }
        this.nextStaffChange = now + random(...STAFF_INTERVAL);
      }
      this.isOpen = true;
    }

    /** The deck has gone: everyone leaves at once. */
    close() {
      this.people = [];
      this.seats = [];
      this.nuclearQueue = [];
      this.detonation = null;
      this.isOpen = false;
      this.nextStaffChange = 0;
    }

    /** The effort a desk is painted for, if its session has one. */
    deskEffort(desk) {
      const person = this.people.find((p) => p.desk === desk && !p.isLeaving);
      return person && person.deskEffort ? person.deskEffort : null;
    }

    step(now) {
      const elapsed = Math.min(now - (this.lastStep ?? now), 0.1);
      this.lastStep = now;
      this.changeStaff(now);
      for (const person of this.people) {
        this.decide(person, now);
        this.walk(person, elapsed, now);
      }
      this.press(now);
      this.people = this.people.filter((p) => !(p.isLeaving && !p.isWalking));
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
      return SPOTS.map((_, spot) => spot).filter((spot) => !this.people.some((other) =>
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
      person.session = session;

      // Only a press of ☢ Max sends them to the button; the dial reaching max
      // just repaints the desk. Turned back down before they get there, they
      // go back to their desk.
      const pressed = session.maxPressedAt;
      if (pressed && pressed !== person.answeredPress && !person.isGoingNuclear) {
        person.isGoingNuclear = true;
        this.nuclearQueue.push(person);
      } else if (person.isGoingNuclear && session.effort !== 'max' && person.pressedAt === null) {
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
      if (person.session.state !== 'idle') {
        if (person.place !== desk) this.send(person, desk);
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
        person.isFacingAway = SPOTS[spot].pose === 'away';
        person.nextMove = now + random(12, 30);
      } else {
        person.isFacingAway = false;
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
   * Draws one frame of the office: the room, then everything on the floor
   * from back to front, then what floats above it: the screens' light, the
   * speech bubbles and the name on each desk.
   */
  function drawOffice(ctx, office, frame) {
    const { now, hour, minute, width, height, ratio } = frame;

    // A whole number of the screen's pixels to each art pixel keeps every
    // edge sharp; what's left over is a border round the room.
    const fit = Math.min(width / WIDTH, height / HEIGHT);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    let ox = Math.round((width - WIDTH * scale) / 2), oy = Math.round((height - HEIGHT * scale) / 2);

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

    const isNight = hour >= 20 || hour < 5;
    const alarm = sinceBlast >= 0 && sinceBlast < ALARM_LENGTH ? sinceBlast : null;
    const colour = (state) => fromCss(office.colours[state]) ?? fromCss(STANDARD_STATES[state]);
    const sessionAt = (desk) => (desk < office.seats.length ? office.seats[desk].session : null);

    ctx.clearRect(0, 0, width, height);

    /* The room */

    function sky() {
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
      } else if (hour >= 7 && hour < 17) {
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
      fill(0, 0, WIDTH, WALL_BOTTOM, PALETTE.wall);
      fill(LOUNGE_LEFT, 0, WIDTH - LOUNGE_LEFT, WALL_BOTTOM, PALETTE.loungeWall);
      fill(0, 0, WIDTH, 2, PALETTE.wallTop);
      fill(0, 30, WIDTH, 8, PALETTE.wainscot);
      fill(0, 30, WIDTH, 1, PALETTE.rail);
      fill(0, 38, WIDTH, 2, PALETTE.baseboard);
      fill(LOUNGE_LEFT, 0, 1, WALL_BOTTOM, PALETTE.wallTop);

      for (const x of [28, 94, 160]) drawWindow(x, 6, 32, 20, false);
      drawWindow(260, 6, 30, 20, true);

      // A whiteboard and a pinboard between the windows
      fill(65, 9, 24, 16, 0xb8bfcc);
      fill(66, 10, 22, 14, PALETTE.whiteboard);
      fill(68, 12, 10, 1, 0x4c8bf5);
      fill(68, 15, 14, 1, 0xd96a5a);
      fill(68, 18, 8, 1, 0x4f9a5a);
      fill(80, 18, 5, 1, 0x4c8bf5);
      fill(65, 25, 24, 1, PALETTE.frame);
      fill(133, 10, 20, 16, PALETTE.doorPanel);
      fill(134, 11, 18, 14, PALETTE.cork);
      fill(136, 13, 4, 4, 0xf2d35b);
      fill(142, 14, 5, 4, 0xf28fb0);
      fill(137, 19, 5, 3, 0x8fc6f0);
      fill(145, 20, 4, 3, PALETTE.paper);

      drawDoor();
      drawClock(CORRIDOR_X, 6);

      // The warning light beside the door, lit while the alarm sounds
      fill(195, 27, 7, 2, PALETTE.frame);
      if (alarm === null) fill(196, 23, 5, 4, PALETTE.alarmOff);
      else fill(196, 23, 5, 4, PALETTE.alarm, 0.75 + 0.25 * Math.sin(alarm * 20));
      fill(197, 23, 2, 1, WHITE, alarm === null ? 0.15 : 0.6);
    }

    function drawFloor() {
      const top = WALL_BOTTOM, depth = HEIGHT - top;
      fill(0, top, LOUNGE_LEFT, depth, PALETTE.wood);
      let row = 0;
      for (let y = top + 4; y < HEIGHT; y += 5, row++) {
        fill(0, y, LOUNGE_LEFT, 1, PALETTE.plankSeam);
        for (let x = (row % 3) * 11; x < LOUNGE_LEFT; x += 33) fill(x, y - 4, 1, 4, PALETTE.plankSeam);
      }
      fill(LOUNGE_LEFT, top, WIDTH - LOUNGE_LEFT, depth, PALETTE.carpet);
      fill(LOUNGE_LEFT, top, 1, depth, PALETTE.carpetEdge);
      fill(244, 124, 64, 20, PALETTE.rugEdge);
      fill(246, 126, 60, 16, PALETTE.rug);
      fill(207, 40, 14, 2, PALETTE.mat);
      fill(0, top, WIDTH, 1, SHADOW);
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
      if (occupant.session.state === 'thinking') {
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
      fill(309, 158, 4, 6, PALETTE.leaf);
      fill(313, 154, 4, 10, PALETTE.leafDark);
      fill(316, 159, 4, 6, PALETTE.leaf);
      fill(311, 162, 7, 6, PALETTE.leaf);
      fill(311, 168, 7, 8, PALETTE.pot);
      fill(310, 168, 9, 1, 0x8a4f32);
      fill(311, 176, 7, 1, SHADOW);
    }

    /**
     * The nuclear button: a red dome on a post in hazard stripes, like the
     * ☢ Max button on the deck. The dome sinks while it's pressed.
     */
    function drawButton() {
      const { x, y } = BUTTON;
      const pressedAt = office.nuclearQueue[0] ? office.nuclearQueue[0].pressedAt : null;
      const sink = pressedAt !== null && now - pressedAt < 0.5 ? 1 : 0;
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

    function poseOf(person) {
      if (person.isWalking) return { kind: 'walk', step: Math.floor(now * 6) % 2 };
      if (person.isGoingNuclear && person.place === 'button') return { kind: 'press', raised: person.pressedAt === null };
      if (deskOf(person.place) !== null) {
        if (person.session.state === 'asking') return { kind: 'wave', frame: Math.floor(now * 4) % 2 };
        if (person.session.state === 'error') return { kind: 'slump' };
        return { kind: 'sit' };
      }
      const spot = spotOf(person.place);
      if (spot !== null) return { kind: SPOTS[spot].pose === 'sit' ? 'sit' : 'stand' };
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
     * A person is 17 art pixels tall, standing: two rows of hair, five of
     * face, six of shirt, a belt, two of legs and a row of shoes.
     */
    function drawPerson(person) {
      const pose = poseOf(person);
      const x = Math.round(person.position.x), top = topOf(person, pose);
      const { look } = person, away = person.isFacingAway;
      const shirtColour = person.isStaff ? STAFF_SHIRTS[Math.floor(look.phase * STAFF_SHIRTS.length) % STAFF_SHIRTS.length]
        : SHIRTS[person.session.agent] ?? SHIRTS.claude;
      const sleeve = (px, py, w, h) => {
        ctx.fillStyle = css(shirtColour, 1, 0.78);
        ctx.fillRect(ox + px * scale, oy + py * scale, w * scale, h * scale);
      };

      // Legs, for anyone not sitting down
      if (pose.kind !== 'sit' && pose.kind !== 'slump') {
        const lift = pose.kind === 'walk' ? (pose.step === 0 ? [1, 0] : [0, 1]) : [0, 0];
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
      if (pose.kind === 'slump') {
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
      if (since < 0.08) fill(0, 0, WIDTH, HEIGHT, WHITE, 0.5);
      if (since < FLASH_LENGTH) fill(0, 0, WIDTH, HEIGHT, PALETTE.alarm, 0.35 * (1 - since / FLASH_LENGTH));
      fill(0, 0, WIDTH, HEIGHT, PALETTE.alarm, 0.07 * (0.5 + 0.5 * Math.sin(since * 12)) * fade);

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
      const light = session.state === 'idle' || blinkedOff ? PALETTE.monitorOn : colour(session.state);

      if (session.state !== 'idle') fill(x + 3, y - 13, 19, 14, light, 0.12);
      fill(x + 5, y - 11, 15, 1, light);
      fill(x + 5, y - 10, 1, 9, light);
      fill(x + 19, y - 10, 1, 9, light);

      if (session.state === 'thinking') {
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
      // Going nuclear says enough on its own.
      if (person.isLeaving || person.isGoingNuclear) return;
      const state = person.session.state;
      const pose = poseOf(person);
      const x = Math.round(person.position.x), top = topOf(person, pose);

      if (state === 'idle') {
        // A nap, after a while on the couch
        const spot = spotOf(person.place);
        if (person.isWalking || spot === null || SPOTS[spot].pose !== 'sit' || now - person.arrivedAt <= 20) return;
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
     * The project's name under each desk, with its state's colour beside it.
     * A key pinned to a project with nothing running keeps its name, dimmed.
     */
    function drawLabel(desk) {
      if (desk >= office.seats.length) return;
      const s = office.seats[desk];
      const name = s.session ? s.session.name : s.pin;
      if (!name) return;

      const size = Math.max(LABEL_SIZE * scale, LABEL_SMALLEST * ratio);
      ctx.font = `600 ${size}px ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const dotSize = s.session ? size * 0.55 : 0;
      const gap = s.session ? size * 0.4 : 0;
      const padding = size * 0.5;
      // Cut to the space between desks, so labels never run into each other.
      const room = (DESK_COLUMNS[1] - DESK_COLUMNS[0] - 2) * scale - dotSize - gap - padding * 2;
      const shown = fitText(ctx, name, room);
      const measured = ctx.measureText(shown).width;

      const center = screen(DESKS[desk].x + DESK_WIDTH / 2, DESKS[desk].y + 20.5);
      const w = measured + dotSize + gap + padding * 2, h = size * 1.25;
      const left = center.x - w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundedRect(ctx, left, center.y - h / 2, w, h, h / 2);
      ctx.fill();
      if (s.session) {
        ctx.fillStyle = css(colour(s.session.state));
        ctx.beginPath();
        ctx.arc(left + padding + dotSize / 2, center.y, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(255,255,255,${s.session ? 0.92 : 0.45})`;
      ctx.fillText(shown, left + padding + dotSize + gap, center.y);
    }

    /* The frame, back to front */

    drawWall();
    drawFloor();

    // What stands on the floor, drawn in order of where it touches the
    // floor, so that nearer things cover farther ones.
    const items = [
      [46.5, drawCounter], [50, drawCooler], [110, drawCouchBack], [117, drawCouchFront],
      [134, drawCoffeeTable], [157, drawPingPong], [176, drawPlant], [176.5, drawButton],
    ];
    DESKS.forEach((d, desk) => {
      items.push([d.y + 5, () => drawDesk(desk)]);
      items.push([d.y + 3.5, () => drawChair(desk)]); // just behind whoever sits in it
    });
    for (const person of office.people) items.push([person.position.y, () => drawPerson(person)]);
    items.sort((a, b) => a[0] - b[0]).forEach(([, draw]) => draw());

    if (isNight) fill(0, 0, WIDTH, HEIGHT, PALETTE.night, 0.3);
    drawDetonation();
    DESKS.forEach((_, desk) => drawScreenLight(desk));
    office.people.forEach(drawBubble);
    DESKS.forEach((_, desk) => drawLabel(desk));
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

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    const office = new Office();
    let visible = true;
    let frame = null;
    let last = 0;

    // The canvas holds the screen's own pixels, so the art can be scaled by
    // a whole number of them.
    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      ctx.imageSmoothingEnabled = false;
    }
    new ResizeObserver(resize).observe(canvas);

    function tick(time) {
      frame = null;
      if (!visible || document.hidden) return;
      frame = requestAnimationFrame(tick);
      if (time - last < FRAME_TIME - 1) return;
      last = time;
      const now = time / 1000, date = new Date();
      office.step(now);
      drawOffice(ctx, office, {
        now, hour: date.getHours(), minute: date.getMinutes(),
        width: canvas.width, height: canvas.height, ratio: window.devicePixelRatio || 1,
      });
    }

    function run() {
      if (frame === null && visible && !document.hidden) frame = requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', run);
    resize();
    run();

    return {
      show(snapshot) { office.apply(seatsOf(snapshot), snapshot.theme, performance.now() / 1000); },
      close() { office.close(); },
      setVisible(on) {
        visible = on;
        if (on) { resize(); run(); }
      },
    };
  }

  window.AgentOffice = { create };
})();
