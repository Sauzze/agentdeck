/*
 * The Agent Office: the deck's sessions as people in a little pixel-art
 * office, for the phone's Office view and the /office page.
 *
 * Each key is a desk, in the same order, with a person at it who acts out
 * what their session is doing. Everything is drawn in code on a 320 × 180
 * grid of art pixels, or 224 × 372 on a screen held upright, scaled by a
 * whole number of the screen's pixels so every edge stays sharp.
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
 *
 * Its sound, once set up and tapped, is in the style of an old console. A
 * piece of the room asks for one of its sounds by name with
 * `office.cue(name, x)`; see SOUNDS.
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

  /** Where idle people spend their time in the lounge, whatever its corner holds, and the part of the lounge each is by. */
  const LOUNGE_SPOTS = [
    { x: 243, y: 50, pose: 'away', part: 'wall' },  // the coffee machine
    { x: 274, y: 47, pose: 'away', part: 'wall' },  // the window
    { x: 297, y: 55, pose: 'stand', part: 'wall' }, // the water cooler
    { x: 258, y: 116, pose: 'sit', part: 'couch' },  // the couch
    { x: 276, y: 116, pose: 'sit', part: 'couch' },
    { x: 294, y: 116, pose: 'sit', part: 'couch' },
    { x: 238, y: 158, pose: 'stand', part: 'pong' }, // ping-pong
    { x: 298, y: 158, pose: 'stand', part: 'pong' },
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
   * The room's two shapes. Wide, as above, for a screen on its side. Tall,
   * for one held upright: the same back wall, door and desks, with the
   * lounge below them, behind a wall of its own that the corridor runs
   * through. Each part of the lounge is drawn as in the wide room, moved by
   * the tall room's offset for that part, and so is every place round it.
   */
  const WIDE = { width: WIDTH, height: HEIGHT, offsets: {} };
  const TALL = {
    width: 224, height: 372,
    loungeWall: 216, // where the lounge's wall meets the floor: the back wall's height below the desks
    offsets: {
      wall: { x: -214, y: 176 }, // the counter, the window and the cooler, along the lounge's wall
      corner: { x: -120, y: 170 },
      couch: { x: -236, y: 140 }, // with its rug and coffee table
      pong: { x: -150, y: 170 },
      plant: { x: -222, y: 192 },
      button: { x: -10, y: 129 }, // in the lounge, below the doorway at the foot of the corridor
      mic: { x: -97, y: 192 },
    },
  };
  let shape = WIDE;
  /** Steps into the lounge, held upright, through the doorway at the corridor's foot. */
  const DOORWAY_STEP = 6;

  /** `point`, as it is in the wide room, where `part` of the lounge puts it in the room's shape now. */
  function placed(part, point) {
    const { x, y } = shape.offsets[part] || { x: 0, y: 0 };
    const moved = { ...point, x: point.x + x, y: point.y + y };
    if (point.depth !== undefined) moved.depth = point.depth + y;
    return moved;
  }

  /** Held upright, whether `point` is in the lounge, past its wall. */
  const inLounge = (point) => shape.loungeWall !== undefined && point.y > shape.loungeWall;

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
    corner: ['arcade', 'vending', 'foosball', 'fishtank', 'books', 'dragon', 'pinball', 'jukebox', 'pool', 'piano', 'drums',
      'telescope', 'jellyfish', 'bonsai', 'jungle', 'coffee', 'servers', 'printer', 'boxing', 'treadmill', 'hottub', 'ballpit',
      'campfire', 'none'],
    sky: ['live', 'day'],
    pet: ['none', 'cat', 'dog', 'lizard', 'monkey'],
    season: ['calendar', 'off'],
    sound: ['off', 'quiet', 'normal'],
    desk: ['wood', 'walnut', 'white', 'black'],
    workspace: ['desk', 'standing', 'gaming', 'tent', 'box', 'beanbag', 'igloo', 'van', 'cockpit', 'ship', 'throne', 'greenhouse'],
    chair: ['teal', 'black', 'red', 'grey', 'green'],
    staff: ['some', 'none', 'many'],
  };
  /**
   * The desks' finish when no effort paints them, from the edge catching the
   * light to the drawer; the chairs' colour, its back and its top; and how
   * many of the office's own staff hang about in the lounge with no sessions
   * running, one fewer for each that is.
   */
  const DESK_FINISHES = {
    wood: { edge: 0xdcb78c, top: 0xc49a6c, front: 0x8c6744, lip: 0x76573a, drawer: 0x9b7550 },
    walnut: { edge: 0xa87a56, top: 0x7e5536, front: 0x5a3b25, lip: 0x4a301e, drawer: 0x6a4630 },
    white: { edge: 0xfbfaf6, top: 0xe9e6de, front: 0xc9c4b8, lip: 0xb3ad9f, drawer: 0xd8d3c8 },
    black: { edge: 0x5a5f6c, top: 0x3c404a, front: 0x272a31, lip: 0x1f2228, drawer: 0x30333b },
  };
  const CHAIRS = {
    teal: [0x2f5560, 0x3f7080], black: [0x23252c, 0x353842], red: [0x7a2e2e, 0x9a3c3a], grey: [0x5a5f6c, 0x737987],
    green: [0x2f5a3a, 0x3f7a4c],
  };
  const STAFF_COUNTS = { none: 0, some: 4, many: 6 };
  /**
   * What each desk can be, besides a desk: where its screen is, from the
   * desk's corner (the top-left of a monitor 13 × 9, whose back shows the
   * turn's time); whether its person stands at it; whether it has the
   * office's chair, or what's carried over their head instead when they're
   * moved to another desk; where what's on the desk goes, moved from
   * where a desk has it; and how far above the desk's corner it reaches, so
   * a finger finds it there. Each is drawn in drawOffice's WORKSPACE_PARTS.
   */
  const WORKSPACES = {
    desk: { screen: { dx: 6, dy: -10 }, stands: false, chair: true, things: { dx: 0, dy: 0 }, top: -14 },
    standing: { screen: { dx: 6, dy: -12 }, stands: true, chair: false, carry: [0x5a5f6c, 0x737987], things: { dx: 0, dy: 0 }, top: -14 },
    gaming: { screen: { dx: 6, dy: -10 }, stands: false, chair: false, carry: [0x1d1f25, 0xd4140b], things: { dx: 0, dy: 0 }, top: -15 },
    tent: { screen: { dx: 22, dy: -3 }, stands: false, chair: false, carry: [0x6f8a4a, 0x8aa65e], things: null, top: -24 },
    box: { screen: { dx: 6, dy: -9 }, stands: false, chair: false, carry: [0xa07a4a, 0xc9a06a], things: { dx: 0, dy: 1 }, top: -14 },
    beanbag: { screen: { dx: 22, dy: -4 }, stands: false, chair: false, carry: [0xc0584a, 0xd96a5a], things: { dx: 4, dy: 12 }, top: -14 },
    igloo: { screen: { dx: 6, dy: -10 }, stands: false, chair: false, carry: [0xc4d2de, 0xeef4f8], things: { dx: 0, dy: 0 }, top: -22 },
    van: { screen: { dx: 11, dy: -10 }, stands: false, chair: true, things: { dx: -1, dy: 0 }, top: -21 },
    cockpit: { screen: { dx: 6, dy: -10 }, stands: false, chair: false, carry: [0x3a3f4a, 0x8a93a3], things: { dx: 0, dy: 0 }, top: -24 },
    ship: { screen: { dx: 6, dy: -10 }, stands: false, chair: false, carry: [0x7a5232, 0x3a3a40], things: null, top: -24 },
    throne: { screen: { dx: 6, dy: -10 }, stands: false, chair: false, carry: [0xd6b25e, 0x9a2a3a], things: { dx: 0, dy: 0 }, top: -23 },
    greenhouse: { screen: { dx: 4, dy: -10 }, stands: false, chair: true, things: { dx: 0, dy: 0 }, top: -23 },
  };
  /** The colours of what can sit on a desk besides a plant, papers and a lamp. */
  const DESK_THINGS = { cactus: 0x5a9a4a, duck: 0xf2cf3a, beak: 0xe8823a, sky: 0x8fc0e8, coffee: 0x5a3a24 };
  /** What each of the back wall's five places can hold, and what it holds unless set up otherwise. */
  const WALL_CHOICES = ['window', 'whiteboard', 'pinboard', 'poster', 'shelf', 'plant', 'bare'];
  const STANDARD_WALL = ['window', 'whiteboard', 'window', 'pinboard', 'window'];
  /** The middle of each of the back wall's places, left to right. */
  const WALL_SLOTS = [44, 77, 110, 143, 176];

  /** A room as the layout gives it: anything unknown or left out is as standard. */
  /**
   * The dress code: an outfit and colour for each size of model, and for
   * each agent while its model isn't known, and your own rules for telling
   * a model's size from its name. Outfits and colours are the team's
   * choices. The apps' Layout.swift and layout.go keep the same.
   */
  const DRESS_SIZES = ['small', 'medium', 'large', 'top'];
  const DRESS_AGENTS = ['claude', 'codex', 'gemini', 'opencode', 'grok'];
  /** The most rules a dress code keeps, and the most characters a rule's words can be. */
  const DRESS_RULE_LIMIT = 20;
  const DRESS_WORDS_LIMIT = 32;
  const AUTO_ATTIRE = { outfit: 'auto', colour: 'auto' };

  /** A dress code as given: anything unknown is Auto, and a rule that can't be read is left out. */
  function dressOf(given) {
    const raw = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
    // Read only when there's something to read: this runs as the office loads, before the team's choices exist.
    const attire = (a) => (a && typeof a === 'object' ? {
      outfit: TEAM_CHOICES.outfit.includes(a.outfit) ? a.outfit : 'auto',
      colour: TEAM_CHOICES.colour.includes(a.colour) ? a.colour : 'auto',
    } : { ...AUTO_ATTIRE });
    const each = (keys, from) => Object.fromEntries(keys.map((key) =>
      [key, attire(from && typeof from === 'object' && Object.hasOwn(from, key) ? from[key] : null)]));
    const rules = (Array.isArray(raw.rules) ? raw.rules : [])
      .map((rule) => ({
        contains: rule && typeof rule.contains === 'string'
          ? [...rule.contains.replace(/[\x00-\x1f\x7f]/g, '').trim().toLowerCase()].slice(0, DRESS_WORDS_LIMIT).join('') : '',
        size: rule && rule.size,
      }))
      .filter((rule) => rule.contains && DRESS_SIZES.includes(rule.size))
      .slice(0, DRESS_RULE_LIMIT);
    return { sizes: each(DRESS_SIZES, raw.sizes), agents: each(DRESS_AGENTS, raw.agents), rules };
  }

  function roomOf(given) {
    const raw = given && typeof given === 'object' ? given : {};
    const room = {};
    for (const [part, choices] of Object.entries(ROOM_CHOICES)) room[part] = choices.includes(raw[part]) ? raw[part] : choices[0];
    room.wall = STANDARD_WALL.map((standard, i) => (Array.isArray(raw.wall) && WALL_CHOICES.includes(raw.wall[i]) ? raw.wall[i] : standard));
    room.team = teamOf(raw.team);
    room.dress = dressOf(raw.dress);
    return room;
  }

  /**
   * Whether someone at a spot of this pose has their back to the room:
   * standing 'away', walking on the spot on a treadmill, or perched on a
   * seat that faces away, as at a piano. 'sit' and 'stand' face the room.
   */
  const facesAway = (pose) => pose === 'away' || pose === 'walk' || pose === 'perch';

  /** Where idle people go round the lounge's corner piece: to play, to buy a snack, to watch the fish. */
  const CORNER_SPOTS = {
    arcade: [{ x: 272, y: 93, pose: 'away' }],
    vending: [{ x: 272, y: 93, pose: 'away' }],
    foosball: [{ x: 272, y: 76, pose: 'stand' }, { x: 272, y: 97, pose: 'away' }],
    fishtank: [{ x: 272, y: 93, pose: 'away' }],
    books: [{ x: 274, y: 94, pose: 'sit' }],
    dragon: [{ x: 306, y: 96, pose: 'stand' }],
    pinball: [{ x: 274, y: 95, pose: 'away' }],
    jukebox: [{ x: 274, y: 94, pose: 'away' }],
    pool: [{ x: 245, y: 86, pose: 'stand' }, { x: 306, y: 86, pose: 'stand' }],
    piano: [{ x: 276, y: 90, pose: 'perch' }],
    drums: [{ x: 276, y: 84, pose: 'sit' }],
    telescope: [{ x: 270, y: 94, pose: 'away' }],
    jellyfish: [{ x: 275, y: 95, pose: 'away' }],
    bonsai: [{ x: 258, y: 94, pose: 'away' }],
    jungle: [],
    coffee: [{ x: 274, y: 77, pose: 'stand' }, { x: 262, y: 98, pose: 'away' }],
    servers: [{ x: 268, y: 95, pose: 'away' }],
    printer: [{ x: 272, y: 95, pose: 'away' }],
    boxing: [{ x: 266, y: 90, pose: 'stand' }],
    treadmill: [{ x: 274, y: 89, pose: 'walk' }],
    hottub: [{ x: 266, y: 88, pose: 'sit' }, { x: 287, y: 88, pose: 'sit' }],
    ballpit: [{ x: 277, y: 88, pose: 'sit' }],
    campfire: [{ x: 255, y: 92, pose: 'sit' }, { x: 297, y: 92, pose: 'sit' }],
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
  /** The lounge's spots, and those round its corner piece, where the room's shape puts them. */
  const spotsOf = (room) => [...LOUNGE_SPOTS.map((spot) => placed(spot.part, spot)), ...CORNER_SPOTS[room.corner].map((spot) => placed('corner', spot))];
  let spots = spotsOf(decor);
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
      default: return { door: DOOR, button: placed('button', PRESSER), queue: placed('button', NEXT_IN_LINE) }[place];
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
   * line. Held upright, the lounge is through the doorway at the foot of
   * the corridor.
   */
  function route(from, place) {
    const target = pointOf(place);
    const walkway = laneTo(place);
    const amongDesks = from.x < CORRIDOR_X - 1 && from.y > WALL_BOTTOM && !inLounge(from);
    const current = laneNearest(from.y);
    const path = [];
    const doorway = { x: CORRIDOR_X, y: shape.loungeWall + DOORWAY_STEP };
    if (inLounge(from) && !inLounge(target)) path.push(doorway);
    if (walkway !== null && amongDesks && walkway === current) {
      path.push({ x: from.x, y: current });
    } else {
      if (amongDesks) path.push({ x: from.x, y: current }, { x: CORRIDOR_X, y: current });
      if (walkway !== null) path.push({ x: CORRIDOR_X, y: walkway });
      else if (place === 'door') path.push({ x: CORRIDOR_X, y: WALL_BOTTOM + 8 });
    }
    if (!inLounge(from) && inLounge(target)) path.push(doorway);
    if (walkway !== null) path.push({ x: target.x, y: walkway });
    path.push({ x: target.x, y: target.y });
    return path.filter((p) => p.x !== from.x || p.y !== from.y);
  }

  /* ---------------------------------------------------------- the palette */

  const PALETTE = {
    wall: 0x2f3446, wallTop: 0x252a3a, loungeWall: 0x353447, wainscot: 0x272b3b, rail: 0x3d4359,
    baseboard: 0x1b1e2a, frame: 0x1b1e2a, sill: 0x8a90a6,
    wood: 0x6f5440, plankSeam: 0x624a38, carpet: 0x3f4a5c, carpetEdge: 0x353e4e, rug: 0x3f6b6b, rugEdge: 0x4f8080,
    deskEdge: 0xdcb78c, deskTop: 0xc49a6c, deskFront: 0x8c6744, handle: 0x3a2a1c,
    monitor: 0x262a35, monitorPanel: 0x2f3442, monitorStand: 0x3d4250, monitorOn: 0x4a5266,
    keyboard: 0x4a5060, keys: 0x5f6678,
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
  /**
   * Each outfit, and what goes with it: jeans and trainers with a T-shirt, a
   * dark suit and an orange tie, denim overalls, a tracksuit's bottoms to
   * match its top, a white shirt's sleeves under a waistcoat.
   */
  const DENIM = 0x46679a, TRAINERS = 0xe9e6df;
  const OUTFITS = {
    tee: { style: 'tee', pants: DENIM, shoes: TRAINERS },
    hoodie: { style: 'hoodie' },
    collar: { style: 'collar' },
    sweater: { style: 'sweater' },
    jacket: { style: 'jacket' },
    suit: { style: 'suit', shirt: 0x2c2f3a, pants: 0x23252d, tie: 0xd97757 },
    labcoat: { style: 'labcoat', shirt: 0xeeeae2 },
    polo: { style: 'polo' },
    cardigan: { style: 'cardigan' },
    hawaiian: { style: 'hawaiian', shoes: 0x8a6a4a },
    tracksuit: { style: 'tracksuit', matching: true, shoes: TRAINERS },
    overalls: { style: 'overalls', pants: DENIM },
    waistcoat: { style: 'waistcoat', sleeves: 0xeeeae2 },
  };

  /**
   * The bigger the model the smarter, unless the dress code says otherwise:
   * small models in a T-shirt and jeans, medium in a collared shirt, large in
   * a jacket, the top ones in a suit and tie. Claude Code's wear its own
   * oranges, from Haiku's bright one to Opus's deep one.
   */
  const SIZE_OUTFITS = { small: 'tee', medium: 'collar', large: 'jacket', top: 'suit' };
  const CLAUDE_SIZE_SHIRTS = { small: 0xf59a3e, medium: 0xd97757, large: 0xa94a2c };
  /**
   * Words model names use for their size, as their own words: so `gemini`
   * isn't `mini`. A model with none of them is medium.
   */
  const SIZE_WORDS = {
    top: ['fable', 'ultra', 'heavy', 'max'],
    small: ['haiku', 'mini', 'nano', 'lite', 'fast', 'small'],
    large: ['opus', 'pro', 'large'],
    medium: ['sonnet', 'flash', 'medium'],
  };

  /** How big a model is, by its name: your own rules first, then the words in it. */
  function sizeOf(model) {
    const name = model.toLowerCase();
    const rule = decor.dress.rules.find((r) => name.includes(r.contains));
    if (rule) return rule.size;
    if (/deep-?think/.test(name)) return 'top';
    const words = name.split(/[^a-z0-9]+/);
    return ['top', 'small', 'large', 'medium'].find((size) => SIZE_WORDS[size].some((word) => words.includes(word))) || 'medium';
  }

  /**
   * What an agent running `model` wears: its project's own outfit on the team
   * card first, then the dress code for the model's size, or for the agent
   * while its model isn't known, then plain clothes in its agent's colour.
   */
  function outfitOf(agent, model, member) {
    const own = SHIRTS[agent] ?? SHIRTS.claude;
    const size = model ? sizeOf(model) : null;
    const code = (size ? decor.dress.sizes[size] : decor.dress.agents[agent]) || AUTO_ATTIRE;
    const chosen = member && member.outfit !== 'auto' ? member.outfit : null;
    const style = chosen || (code.outfit !== 'auto' ? code.outfit : size ? SIZE_OUTFITS[size] : null);
    const outfit = { style: 'plain', shirt: own, pants: PALETTE.pants, shoes: PALETTE.shoes, ...(style ? OUTFITS[style] : {}) };
    // A size's own outfit, left on Auto, is in Claude's oranges; a suit's tie is in its agent's colour.
    if (!chosen && code.outfit === 'auto' && agent === 'claude' && CLAUDE_SIZE_SHIRTS[size]) outfit.shirt = CLAUDE_SIZE_SHIRTS[size];
    if (style === 'suit' && agent && agent !== 'claude') outfit.tie = own;
    const colour = member && member.colour !== 'auto' ? member.colour : code.colour !== 'auto' ? code.colour : null;
    if (colour) outfit.shirt = SHIRT_COLOURS[colour];
    if (outfit.matching) outfit.pants = darker(outfit.shirt);
    return outfit;
  }
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

  /** A colour a third of the way to white, for a knitted band or a highlight. */
  function lighter(hex) {
    const part = (shift) => Math.round((((hex >> shift) & 0xff) * 2 + 255) / 3) << shift;
    return part(16) | part(8) | part(0);
  }

  /** A colour at `shade` of its brightness, as a number: below one darker, above it lighter, as far as white. */
  function shaded(hex, shade) {
    const part = (shift) => Math.min(255, Math.round(((hex >> shift) & 0xff) * shade)) << shift;
    return part(16) | part(8) | part(0);
  }

  /** A bright colour round the colour wheel, `turn` of the way from red, for lights that cycle. */
  function rainbow(turn) {
    const part = (n) => {
      const k = (n + turn * 12) % 12;
      return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return (part(0) << 16) | (part(8) << 8) | part(4);
  }

  /** What people wear besides their clothes: dark lenses, headphones, a bow, glasses, a lab coat's shirt and pen. */
  const SHADES = 0x15161a, HEADPHONES = 0x6a7080, BOW = 0xe0507a, GLASS = 0xcfe3ef, LAB_SHIRT = 0x8fb3d9, LAB_PEN = 0x3f6fc4;
  /** A Hawaiian shirt's yellow flowers, and the overalls' buttons. */
  const HIBISCUS = 0xf2d35b;

  /** A colour as the deck's theme writes it, `#rrggbb`, as a number. */
  function fromCss(text) {
    return /^#[0-9a-f]{6}$/i.test(text || '') ? parseInt(text.slice(1), 16) : null;
  }

  const SKINS = [0xf6d3b3, 0xe8b48a, 0xc98e5f, 0x9b6a43, 0x6e4a2e];
  const HAIRS = [0x2a1d16, 0x4a3022, 0x8a5a2b, 0xd9b26a, 0x1a1a1a, 0x9a9aa0, 0xa8432a];
  const HAIR_STYLES = ['short', 'long', 'spiky', 'bun'];

  /**
   * Your team: each project's agent as you'd like them, by the project's
   * name. Anything left on 'auto' is as the project's name picks it, and
   * clothes on 'auto' are the model's. The apps' Layout.swift and layout.go
   * keep the same choices.
   */
  const TEAM_CHOICES = {
    skin: ['auto', 'porcelain', 'fair', 'light', 'tan', 'olive', 'brown', 'deep', 'ebony'],
    hair: ['auto', 'black', 'espresso', 'brown', 'chestnut', 'auburn', 'ginger', 'blond', 'platinum', 'grey', 'white',
      'pink', 'blue', 'green', 'purple'],
    hairstyle: ['auto', 'short', 'long', 'spiky', 'bun', 'curly', 'ponytail', 'afro', 'mohawk', 'buzz', 'bald'],
    extra: ['none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'beard', 'moustache', 'bow'],
    outfit: ['auto', 'tee', 'hoodie', 'collar', 'sweater', 'jacket', 'suit', 'labcoat', 'polo', 'cardigan', 'hawaiian', 'tracksuit',
      'overalls', 'waistcoat'],
    colour: ['auto', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'yellow', 'grey', 'black', 'white'],
    desk: ['auto', 'plant', 'papers', 'lamp', 'cactus', 'duck', 'trophy', 'photo', 'mug', 'none'],
    workspace: ['auto', ...ROOM_CHOICES.workspace],
  };
  /** The most a nickname can be, in characters, and the most projects a team remembers. */
  const NICKNAME_LIMIT = 16;
  const TEAM_LIMIT = 50;
  const SKIN_TONES = {
    porcelain: 0xfbe3cf, fair: 0xf6d3b3, light: 0xe8b48a, tan: 0xd59b6a, olive: 0xb8875a, brown: 0x9b6a43, deep: 0x6e4a2e,
    ebony: 0x4a3020,
  };
  const HAIR_COLOURS = {
    black: 0x1a1a1a, espresso: 0x2a1d16, brown: 0x4a3022, chestnut: 0x8a5a2b, auburn: 0xa8432a, ginger: 0xd4722f,
    blond: 0xd9b26a, platinum: 0xece0b8, grey: 0x9a9aa0, white: 0xe8e8e8, pink: 0xe878a8, blue: 0x4a7fd8,
    green: 0x4fae6a, purple: 0x8a5ac8,
  };
  const SHIRT_COLOURS = {
    orange: 0xd97757, red: 0xc9443a, pink: 0xe07aa0, purple: 0x7d5ab8, blue: 0x3f6fc4, teal: 0x2f9a92, green: 0x4f9a5a,
    yellow: 0xe8c04a, grey: 0x8a8f9c, black: 0x2c2f3a, white: 0xeeeae2,
  };

  /**
   * A team as given, with anything unknown left out or as 'auto'. It has no
   * prototype, so a project called `constructor` or `__proto__` is only a name.
   */
  function teamOf(given) {
    const team = Object.create(null);
    if (!given || typeof given !== 'object' || Array.isArray(given)) return team;
    // The first projects by name, as many as a team remembers, as the apps keep them.
    const projects = Object.entries(given).filter(([project]) => project).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [project, raw] of projects.slice(0, TEAM_LIMIT)) {
      const member = {};
      const parts = raw && typeof raw === 'object' ? raw : {};
      for (const [part, choices] of Object.entries(TEAM_CHOICES)) member[part] = choices.includes(parts[part]) ? parts[part] : choices[0];
      // On one line, as the apps keep it.
      const name = typeof parts.name === 'string' ? parts.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
      member.name = [...name].slice(0, NICKNAME_LIMIT).join('');
      team[project] = member;
    }
    return team;
  }

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

  /** A session's place on your team, if you've made one for its project. */
  const memberOf = (session) => (session && Object.hasOwn(decor.team, session.name) && decor.team[session.name]) || null;

  /** What a session's agent works at: its own, from your team, or the office's. An empty desk is the office's. */
  function workspaceOf(session) {
    const member = memberOf(session);
    return member && member.workspace !== 'auto' ? member.workspace : decor.workspace;
  }

  /** How a person looks: as their project's name picks it, with your choices for them over the top. */
  function lookFor(person) {
    const member = person.isStaff ? null : memberOf(person.session);
    if (!member) return { ...person.look, extra: 'none' };
    return {
      ...person.look,
      skin: SKIN_TONES[member.skin] ?? person.look.skin,
      hair: HAIR_COLOURS[member.hair] ?? person.look.hair,
      hairStyle: member.hairstyle === 'auto' ? person.look.hairStyle : member.hairstyle,
      extra: member.extra,
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
      this.model = subagent.model || ''; // or dress for their own model, once it's known
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
      this.askingSince = null;  // when they started waiting on you, as far as the office has seen
      this.celebratedAt = null; // when they finished a turn of an hour or more
    }

    get isWalking() { return this.path.length > 0; }
    get isStaff() { return this.desk === null; }

    /** Settled at their own desk, where its keyboard and mug are theirs. */
    get isAtDesk() {
      return this.desk !== null && !this.isWalking && !this.isLeaving && this.place === deskPlace(this.desk);
    }
  }

  /**
   * The office's pet, as set up: it wanders between places of its own, in
   * straight lines, since it can climb and jump where people can't.
   */
  class Pet {
    constructor(kind) {
      this.kind = kind;
      this.position = { x: DOOR.x, y: DOOR.y + 6 }; // in through the door
      this.target = null;      // where it's going or staying: { x, y, depth, pose, follow, grab }
      this.isWalking = false;
      this.facing = -1;        // right, or left
      this.nextMove = 0;
      this.arrivedAt = 0;
      this.carrying = false;   // a cup the monkey took from the counter
    }
  }

  /** Each pet's pace, in art pixels a second, and how long it stays put, in seconds. */
  const PETS = {
    cat: { speed: 20, stay: [8, 20] },
    dog: { speed: 30, stay: [5, 14] },
    lizard: { speed: 6, stay: [15, 40] },
    monkey: { speed: 38, stay: [5, 12] },
  };
  /** The lizard freezes while anyone is this close, in art pixels. */
  const LIZARD_SHY = 14;
  /** The dog follows someone walking for this long at most, in seconds. */
  const FOLLOW_FOR = 8;

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
      this.pet = null;
      // When each session started waiting on you, by its id. It outlasts
      // close(), so a room started over after being out of sight still
      // knows who has been kept waiting.
      this.waiting = new Map();
      this.cues = []; // sounds asked for by name since the last frame: see SOUNDS
    }

    /** Asks for one of the office's sounds by name, from `x` across the room, or the middle. */
    cue(name, x = null) {
      this.cues.push({ name, x });
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
      if (next.pet !== decor.pet) this.pet = next.pet === 'none' ? null : new Pet(next.pet);
      const boardGone = next.wall.indexOf('whiteboard') !== decor.wall.indexOf('whiteboard');
      decor = next;
      spots = spotsOf(decor);
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

    /**
     * The room takes another shape. The desks stay where they are; anyone
     * on the way somewhere is there at once, the lounge's places having
     * moved, and the pet starts again from the door.
     */
    reshape(next, now) {
      shape = next;
      spots = spotsOf(decor);
      for (const walker of [...this.people, ...this.interns]) {
        if (walker.isWalking) {
          walker.arrivedAt = now;
          walker.nextMove = now + random(8, 20);
        }
        walker.path = [];
        walker.position = pointOf(walker.place);
        const spot = spotOf(walker.place);
        if (spot !== null) walker.isFacingAway = facesAway(spots[spot].pose);
      }
      if (this.pet) this.pet = new Pet(this.pet.kind);
    }

    apply(seats, colours, now) {
      this.seats = seats.slice(0, DESKS.length);
      this.colours = colours || {};

      const current = new Map();
      this.seats.forEach((s, desk) => { if (s.session) current.set(s.session.id, { desk, session: s.session }); });
      for (const id of this.waiting.keys()) if (current.get(id)?.session.state !== 'asking') this.waiting.delete(id);
      for (const [id, { session }] of current) if (session.state === 'asking' && !this.waiting.has(id)) this.waiting.set(id, now);
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
        person.askingSince = this.waiting.get(placement.session.id) ?? null;
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
          member.isFacingAway = facesAway(spots[spot].pose);
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
        const still = wanted.get(intern.id);
        // A subagent's model is known once it has replied.
        if (still && still.subagent.model) intern.model = still.subagent.model;
        if (intern.isLeaving || still) continue;
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
      if (this.pet) this.movePet(this.pet, this.elapsed, now);
    }

    /** The agent who has been working longest, at their desk, if anyone is. */
    hardestWorker() {
      const working = this.people.filter((p) => !p.isStaff && p.isAtDesk && p.session.state === 'thinking' && p.session.turnStartedAt);
      return working.sort((a, b) => a.session.turnStartedAt - b.session.turnStartedAt)[0] || null;
    }

    /** Where the pet could go next: each kind has its own haunts. */
    petPlaces(pet) {
      const places = [];
      const worker = this.hardestWorker();
      const desk = worker && DESKS[worker.desk];
      const taken = (spot) => this.people.some((p) => p.place === spotPlace(spot) && !p.isLeaving);
      /** On top of the corner piece, where there's a top to sit on, drawn after it. */
      const tops = {
        arcade: { x: 271, y: 60 }, vending: { x: 271, y: 58 }, fishtank: { x: 272, y: 60 }, books: { x: 297, y: 57 },
        pinball: { x: 274, y: 51, depth: 90.5 }, jukebox: { x: 274, y: 56, depth: 88.5 }, piano: { x: 268, y: 58 },
        jellyfish: { x: 276, y: 51, depth: 91.5 }, servers: { x: 283, y: 50, depth: 89.5 }, printer: { x: 270, y: 56, depth: 91.5 },
        coffee: { x: 289, y: 63, depth: 93.5 },
      };
      /** Beside the corner piece, where the cat likes to be: watching the fish, warm by the fire, on the dragon's gold. */
      const watches = {
        fishtank: { x: 262, y: 95, pose: 'sit' }, jellyfish: { x: 262, y: 95, pose: 'sit' },
        campfire: { x: 276, y: 99, pose: 'sleep' }, dragon: { x: 284, y: 97, pose: 'sleep' },
      };
      switch (pet.kind) {
        case 'cat':
          [3, 4, 5].forEach((spot) => { if (!taken(spot)) places.push(placed('couch', { x: LOUNGE_SPOTS[spot].x, y: 113, pose: 'sleep' })); });
          for (const p of this.people) {
            if (p.isStaff || !p.isAtDesk) continue;
            // Where what's on the desk is, or on a desk with nowhere for it, its end.
            const { dx, dy } = WORKSPACES[workspaceOf(p.session)].things || { dx: 0, dy: 0 };
            const { x, y } = DESKS[p.desk];
            places.push({ x: x + 36 + dx, y: y + 2 + dy, depth: y + 5.6 + dy, pose: 'sit' });
          }
          if (desk) places.push({ x: desk.x - 5, y: desk.y + 15, pose: 'sit' });
          if (watches[decor.corner]) places.push(placed('corner', watches[decor.corner]));
          places.push(placed('wall', { x: 252, y: 33, depth: 47, pose: 'sit' }));
          break;
        case 'dog': {
          places.push(placed('couch', { x: 276, y: 138, pose: 'lie' }), { x: CORRIDOR_X, y: 72, pose: 'sit' }, placed('corner', { x: 290, y: 62, pose: 'sit' }));
          if (desk) places.push({ x: desk.x + DESK_WIDTH + 6, y: desk.y + 15, pose: 'lie' });
          const walker = this.people.find((p) => p.isWalking && !p.isLeaving);
          if (walker) places.push({ follow: walker, pose: 'stand' });
          break;
        }
        case 'lizard':
          decor.wall.forEach((piece, slot) => { if (piece === 'window') places.push({ x: WALL_SLOTS[slot] + 19, y: 22, depth: 41.5, pose: 'still' }); });
          places.push(placed('wall', { x: 296, y: 24, depth: 41.5, pose: 'still' }), placed('corner', { x: 276, y: 58, pose: 'still' }));
          if (desk) {
            const { screen } = WORKSPACES[workspaceOf(worker.session)];
            places.push({ x: desk.x + screen.dx + 6, y: desk.y + screen.dy, depth: desk.y + 5.6, pose: 'still' });
          }
          break;
        case 'monkey':
          places.push(placed('wall', { x: 308, y: 18, depth: 50.5, pose: 'sit' }), { x: CORRIDOR_X, y: 13, depth: 41.5, pose: 'sit' },
            placed('couch', { x: 270, y: 102, depth: 110.5, pose: 'sit' }), placed('wall', { x: 247, y: 33, depth: 47, pose: 'sit', grab: true }));
          if (tops[decor.corner]) places.push(placed('corner', { depth: 86.5, ...tops[decor.corner], pose: 'sit' }));
          break;
      }
      return places;
    }

    movePet(pet, elapsed, now) {
      const { speed, stay } = PETS[pet.kind];
      const follow = pet.target && pet.target.follow;
      if (follow && (follow.isLeaving || !follow.isWalking || now - pet.arrivedAt > FOLLOW_FOR)) {
        pet.target = null;
        pet.isWalking = false;
        pet.nextMove = now;
      }
      if (!pet.isWalking && now >= pet.nextMove) {
        const others = this.petPlaces(pet).filter((p) => !pet.target || p.x !== pet.target.x || p.y !== pet.target.y);
        if (others.length) {
          // The monkey leaves the counter with a cup, and keeps it until it moves on again.
          pet.carrying = !!(pet.target && pet.target.grab);
          pet.target = pick(others);
          pet.isWalking = true;
          pet.arrivedAt = now;
        } else {
          pet.nextMove = now + random(...stay);
        }
      }
      if (!pet.isWalking) return;
      // The lizard won't move while anyone is near.
      if (pet.kind === 'lizard' && this.people.some((p) => Math.hypot(p.position.x - pet.position.x, p.position.y - pet.position.y) < LIZARD_SHY)) return;
      const following = pet.target.follow;
      const to = following ? { x: following.position.x - 7, y: following.position.y + 1 } : pet.target;
      const dx = to.x - pet.position.x, dy = to.y - pet.position.y, distance = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) pet.facing = dx > 0 ? 1 : -1;
      const stride = speed * elapsed;
      if (distance > stride) {
        pet.position.x += (dx / distance) * stride;
        pet.position.y += (dy / distance) * stride;
        return;
      }
      pet.position = { x: to.x, y: to.y };
      if (following) return; // keeps up until the person stops
      pet.isWalking = false;
      pet.arrivedAt = now;
      pet.nextMove = now + random(...stay);
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
      return Math.max(0, STAFF_COUNTS[decor.staff] - this.people.filter((p) => !p.isStaff && !p.isLeaving).length);
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
      const before = person.session;
      const wasIdle = before.state === 'idle';
      const session = placement.session;
      if (session.tool !== before.tool) person.toolSince = now;
      person.session = session;

      person.askingSince = this.waiting.get(session.id) ?? null;
      // A turn of an hour or more, finished: a little party.
      const finished = before.state === 'thinking' && (session.state === 'unread' || session.state === 'idle');
      if (finished && before.turnStartedAt && Date.now() - before.turnStartedAt >= LONG_HAUL * 1000) person.celebratedAt = now;

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
        person.isFacingAway = facesAway(spots[spot].pose);
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

  /** Waiting on you longer than this, in seconds, an agent gets agitated, and more so the longer it goes on… */
  const AGITATED_AFTER = 300;
  /** …reaching its worst this much later. */
  const AGITATION_RISE = 600;
  /** A turn this long, in seconds, ends in confetti… */
  const LONG_HAUL = 3600;
  /** …for this long. */
  const PARTY_LENGTH = 3;

  /** How agitated someone waiting on you is, from 0 to 1, or 0 for anyone else. */
  function agitationOf(person, now) {
    if (person.askingSince === null || person.isLeaving) return 0;
    const waited = now - person.askingSince - AGITATED_AFTER;
    return waited < 0 ? 0 : Math.min(1, 0.3 + (0.7 * waited) / AGITATION_RISE);
  }

  /** The season of each month, January first, as the windows show it. */
  const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  /** In summer a bird crosses each window this often, in seconds, taking this long. */
  const BIRD_EVERY = 23;
  const BIRD_CROSSING = 4;

  /** After this long, a turn's timer shows its agent sweating, in seconds. */
  const LONG_TURN = 600;
  /** Digits and a few marks, three art pixels wide and five tall, for timers and counts. */
  const GLYPHS = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'], 8: ['111', '101', '111', '101', '111'],
    9: ['111', '101', '111', '001', '111'], ':': ['0', '1', '0', '1', '0'], '+': ['000', '010', '111', '010', '000'],
    m: ['000', '000', '111', '111', '101'], h: ['100', '100', '111', '101', '101'],
    // The letters the office's buttons spell
    D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
    H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'], K: ['101', '101', '110', '101', '101'],
    O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'], R: ['110', '101', '110', '101', '101'],
    U: ['101', '101', '101', '101', '111'], Y: ['101', '101', '010', '010', '010'], "'": ['1', '1', '0', '0', '0'],
    ' ': ['00', '00', '00', '00', '00'],
  };
  /** How wide `text` is in the pixel font. */
  const textWidth = (text) => [...text].reduce((w, c) => w + GLYPHS[c][0].length + 1, -1);
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
  /**
   * Held, then moved this far, in CSS pixels, the finger picks the agent up
   * instead: carried to another desk and let go there, the two desks swap.
   */
  const CARRY_AFTER = 10;
  const CHIP_GAP = 1;
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

  /** The chips on the desk `desk`: across its front, a little wider than it, kept inside the room. */
  function effortChips(desk) {
    const { x, y } = DESKS[desk];
    const w = EFFORTS.length * CHIP.w + (EFFORTS.length - 1) * CHIP_GAP;
    const left = Math.max(1, Math.min(shape.width - 1 - w, Math.round(x + DESK_WIDTH / 2 - w / 2)));
    return { left, top: y + 5, w, h: CHIP.h, chips: EFFORTS.map((level, i) => ({ level, x: left + i * (CHIP.w + CHIP_GAP), y: y + 5 })) };
  }

  /**
   * With hiring and firing on, a desk held down also offers a pixel button:
   * YOU'RE FIRED above its agent's chips, or HIRE on an empty desk. In art
   * pixels, kept inside the room.
   */
  function deskButton(desk, kind) {
    const label = kind === 'fire' ? "YOU'RE FIRED" : '+ HIRE';
    const w = textWidth(label) + 8, h = 11;
    const { x, y } = DESKS[desk];
    const left = Math.max(1, Math.min(shape.width - 1 - w, Math.round(x + DESK_WIDTH / 2 - w / 2)));
    return { kind, label, left, top: kind === 'fire' ? y - 8 : y + 4, w, h };
  }

  /** The question before anyone is fired: a panel in the middle of the room, with its two keys. */
  const FIRE_DIALOG = { w: 132, h: 52 };
  const DIALOG_KEY = { w: 34, h: 13 };
  function fireDialog() {
    const { w, h } = FIRE_DIALOG;
    const left = Math.round(shape.width / 2 - w / 2), top = Math.round(shape.height / 2 - h / 2);
    const y = top + h - DIALOG_KEY.h - 6;
    return {
      left, top, w, h,
      keys: [
        { action: 'keep', label: 'KEEP', x: left + 22, y, ...DIALOG_KEY },
        { action: 'fired', label: 'FIRE', x: left + w - 22 - DIALOG_KEY.w, y, ...DIALOG_KEY },
      ],
    };
  }

  /** The choice keys for the agent at `desk`: a panel just above its head, pointing down at it, kept inside the room. */
  function choicePanel(desk) {
    const w = CHOICE_INSET * 2 + CHOICE_KEY.w * 4 + CHOICE_GAP * 2 + CHOICE_SPLIT;
    const h = CHOICE_INSET * 2 + CHOICE_KEY.h;
    const tip = { x: seat(desk).x - 1, y: DESKS[desk].y - 15 };
    const left = Math.max(1, Math.min(shape.width - 1 - w, tip.x - Math.floor(w / 2)));
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
      if (person.celebratedAt !== null && now - person.celebratedAt < PARTY_LENGTH) return { kind: 'cheer', frame: Math.floor(now * 6) % 2 };
      if (person.session.state === 'asking') {
        // Kept waiting, they wave harder and start to hop.
        const agitation = agitationOf(person, now);
        return { kind: 'wave', frame: Math.floor(now * (4 + 8 * agitation)) % 2, hop: agitation ? Math.floor(now * (3 + 5 * agitation)) % 2 : 0 };
      }
      if (person.session.state === 'error') return { kind: 'slump' };
      return { kind: WORKSPACES[workspaceOf(person.session)].stands ? 'stand' : 'sit' };
    }
    const spot = spotOf(person.place);
    if (spot !== null) {
      const { pose } = spots[spot];
      if (pose === 'walk') return { kind: 'walk', step: Math.floor(now * 6) % 2 };
      return { kind: pose === 'sit' || pose === 'perch' ? 'sit' : 'stand' };
    }
    return { kind: 'stand' };
  }

  /** The top row of a person's hair. Sitting lowers it; standing at the desk to wave raises them back up. */
  function topOf(person, pose) {
    const feet = Math.round(person.position.y);
    if (pose.kind === 'sit') return feet - 15;
    if (pose.kind === 'slump') return feet - 14;
    return feet - 17 - (pose.hop || 0);
  }

  /**
   * Where the room goes on a canvas `width` × `height`, at least `margin`
   * from its edges: a whole number of the screen's pixels to each art pixel
   * keeps every edge sharp, and what's left over is a border round it.
   */
  function fitRoom(width, height, margin = 0) {
    const fit = Math.min((width - margin * 2) / shape.width, (height - margin * 2) / shape.height);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    return { scale, ox: Math.round((width - shape.width * scale) / 2), oy: Math.round((height - shape.height * scale) / 2) };
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
   * every pixel counts, and there is none as the Mac's screen saver: the
   * office goes from edge to edge, with square corners. In CSS pixels.
   */
  const FLOAT_MARGINS = { window: 14, screen: 6, edge: 0 };
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
    const { now, hour, minute, month, width, height, ratio, selected, mic, framed, floating } = frame;
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

    const pixelWidth = textWidth;

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
    /** How far above its corner a desk's workspace reaches, in art pixels: a negative number. */
    const reachOf = (desk) => WORKSPACES[workspaceOf(sessionAt(desk))].top;
    // Someone being carried is drawn where the finger has them, so nothing of them stays at their desk.
    const carried = frame.carrying && frame.carrying.person;
    /** Who is at a desk now, if anyone. */
    const occupantOf = (desk) => office.people.find((p) => p.desk === desk && p.isAtDesk && p !== carried) || null;
    const selectedDesk = office.seats.findIndex((s) => s.session && s.session.id === selected);
    /** How far a wobbling thing is pushed sideways, in art pixels. */
    const wobble = (what) => (frame.wobble && frame.wobble.what === what && now - frame.wobble.at < WOBBLE_LENGTH
      ? Math.round(Math.sin((now - frame.wobble.at) * 50)) : 0);
    const lookingUp = mic.heldAt !== null && now - mic.heldAt < LOOK_UP_LENGTH;

    ctx.clearRect(0, 0, width, height);

    // Through a window, the room stays inside it, even while it shakes.
    let glass = framed && { x: room.ox, y: room.oy, w: shape.width * scale, h: shape.height * scale, r: WINDOW_CORNER * ratio };
    if (floating) {
      // Edge to edge, bare wall and floor beat bands of nothing.
      const edge = floating === 'edge', reach = edge ? Infinity : FLOAT_REACH;
      const w = Math.min(width - inset * 2, shape.width * scale * reach);
      const h = Math.min(height - inset * 2, shape.height * scale * reach);
      glass = { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h, r: edge ? 0 : WINDOW_CORNER * ratio };
    }
    // What can be seen of the office, in art pixels: the room, and floating,
    // as much of the wall and floor round it as fills the window.
    const seen = floating
      ? { left: Math.floor((glass.x - ox) / scale), top: Math.floor((glass.y - oy) / scale),
          right: Math.ceil((glass.x + glass.w - ox) / scale), bottom: Math.ceil((glass.y + glass.h - oy) / scale) }
      : { left: 0, top: 0, right: shape.width, bottom: shape.height };
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
      if (decor.season === 'calendar') drawSeason(x, y, w, h);
      fill(x + w / 2, y, 1, h, PALETTE.frame);
      fill(x, y + h / 2, w, 1, PALETTE.frame);
      fill(x - 2, y + h + 1, w + 4, 1, decor.season === 'calendar' && SEASONS[month] === 'winter' ? 0xf2f4f8 : PALETTE.sill);
    }

    /** What the season puts in a window: snow, falling leaves or blossom, or a bird crossing now and then in summer. */
    function drawSeason(x, y, w, h) {
      const season = SEASONS[month];
      if (season === 'summer') {
        const lap = ((now + x * 0.37) % BIRD_EVERY) / BIRD_CROSSING;
        const bx = x - 2 + Math.round(lap * (w + 4)), by = y + 4 + Math.round(Math.sin(lap * 6));
        if (lap < 1 && bx > x && bx < x + w - 3) for (const [dx, dy] of [[0, 0], [1, 1], [2, 0]]) dot(bx + dx, by + dy, PALETTE.frame);
        return;
      }
      const falling = { winter: [WHITE], autumn: [0xd9893a, 0xb8562a, 0xe0b040], spring: [0xf6b8cc, WHITE] }[season];
      const speed = season === 'winter' ? 5 : 8, sway = season === 'winter' ? 1 : 2;
      for (let k = 0; k < Math.round(w / 5); k++) {
        const px = x + ((k * 11 + x * 3) % w) + Math.round(Math.sin(now * 1.5 + k) * sway);
        const py = y - 1 + ((now * speed + k * 7.3 + x) % (h + 2));
        if (px >= x && px < x + w && py >= y && py < y + h) dot(px, py, falling[k % falling.length]);
      }
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

    /**
     * Draws `part` of the lounge where the room's shape puts it: just as in
     * the wide room, moved.
     */
    function moved(part, draw) {
      const { x, y } = placed(part, { x: 0, y: 0 });
      ox += x * scale;
      oy += y * scale;
      draw();
      ox -= x * scale;
      oy -= y * scale;
    }

    function drawWall() {
      const { left, top, right, width: across } = seen;
      const paint = PAINTS[decor.paint];
      // Held upright, the back wall is the office's alone: the lounge has its own, below.
      const wide = shape === WIDE, loungeLeft = wide ? LOUNGE_LEFT : right;
      fill(left, top, loungeLeft - left, WALL_BOTTOM - top, paint.wall);
      fill(loungeLeft, top, right - loungeLeft, WALL_BOTTOM - top, paint.lounge);
      fill(left, top, across, 2, paint.top);
      fill(left, 30, across, 8, paint.wainscot);
      fill(left, 30, across, 1, paint.rail);
      fill(left, 38, across, 2, PALETTE.baseboard);
      if (wide) fill(LOUNGE_LEFT, top, 1, WALL_BOTTOM - top, paint.top);

      decor.wall.forEach((piece, slot) => drawWallPiece(piece, WALL_SLOTS[slot]));
      // String lights along the top of the wall through December
      if (decor.season === 'calendar' && month === 11) {
        fill(left, 3, across, 1, PALETTE.frame);
        const bulbs = [0xff5a4a, 0xf2d35b, 0x6fd36f, 0x4c8bf5];
        for (let bx = left - (left % 6) + 3, i = 0; bx < right; bx += 6, i++) {
          const lit = (Math.floor(now * 1.5) + i) % 4 !== 0;
          fill(bx, 4, 2, 2, bulbs[((i % 4) + 4) % 4], lit ? 1 : 0.35);
        }
      }
      if (wide) drawWindow(260, 6, 30, 20, true);

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
      // The office's floor, to the lounge: on its right, or held upright, behind its wall.
      const wide = shape === WIDE;
      const officeRight = wide ? LOUNGE_LEFT : right, officeBottom = wide ? bottom : shape.loungeWall;
      const top = WALL_BOTTOM, depth = officeBottom - top, across = officeRight - left;
      /** Squares of `size` from the room's corner outwards, cut at the lounge: `paint(x, y, column, row, width)` for each. */
      const squares = (size, paint) => {
        for (let y = top, r = 0; y < officeBottom; y += size, r++) {
          for (let x = Math.floor(left / size) * size; x < officeRight; x += size) paint(x, y, Math.floor(x / size), r, Math.min(size, officeRight - x));
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
        for (let y = top + 4; y < officeBottom + 4; y += 5, row++) {
          fill(left, y, across, 1, PALETTE.plankSeam);
          // The planks' ends, staggered from row to row, from the room's left edge outwards
          let x = (row % 3) * 11;
          while (x > left) x -= 33;
          for (; x < officeRight; x += 33) fill(x, y - 4, 1, 4, PALETTE.plankSeam);
        }
      }
      const [carpet, carpetEdge] = LOUNGES[decor.lounge];
      if (wide) {
        fill(LOUNGE_LEFT, top, right - LOUNGE_LEFT, depth, carpet);
        fill(LOUNGE_LEFT, top, 1, depth, carpetEdge);
      } else {
        fill(left, officeBottom, right - left, bottom - officeBottom, carpet);
      }
      moved('couch', () => {
        fill(244, 124, 64, 20, PALETTE.rugEdge);
        fill(246, 126, 60, 16, PALETTE.rug);
      });
      fill(207, 40, 14, 2, PALETTE.mat);
      fill(left, top, right - left, 1, SHADOW);
    }

    /**
     * Held upright, the lounge's own wall, as high as the back wall, with
     * its window, and a doorway under the back door through which the
     * corridor goes on into the lounge. It hides the office's floor behind it.
     */
    function drawLoungeWall() {
      const { left, right } = seen;
      const paint = PAINTS[decor.paint];
      const top = shape.loungeWall - WALL_BOTTOM;
      const face = (l, r) => {
        fill(l, top, r - l, WALL_BOTTOM, paint.lounge);
        fill(l, top + 30, r - l, 8, paint.wainscot);
        fill(l, top + 30, r - l, 1, paint.rail);
        fill(l, top + 38, r - l, 2, PALETTE.baseboard);
      };
      // Either side of the doorway, and above it
      face(left, 207);
      face(221, right);
      fill(207, top, 14, 13, paint.lounge);
      fill(left, top, right - left, 2, paint.top);
      // The doorway's frame, open onto the corridor
      fill(205, top + 13, 18, 2, PALETTE.frame);
      fill(205, top + 15, 2, 25, PALETTE.frame);
      fill(221, top + 15, 2, 25, PALETTE.frame);
      moved('wall', () => {
        drawWindow(260, 6, 30, 20, true);
        drawWallPiece('pinboard', 364); // between the cooler and the doorway
      });
    }

    /* Furniture */

    /* Desks, and what else an agent can work at */

    /** A monitor from behind, its top-left at `x`, `y`: its screen faces whoever sits at it. */
    function drawMonitor(x, y) {
      fill(x, y, 13, 9, PALETTE.monitor);
      fill(x + 1, y + 1, 11, 7, PALETTE.monitorPanel);
      fill(x + 5, y + 9, 3, 2, PALETTE.monitorStand);
    }

    /** A laptop from behind, the top-left of its lid at `x`, `y`, its base seen edge on below it. */
    function drawLaptop(x, y) {
      fill(x, y, 13, 8, PALETTE.monitor);
      fill(x + 1, y + 1, 11, 6, PALETTE.monitorPanel);
      fill(x - 1, y + 8, 15, 1, PALETTE.keys);
    }

    /** A keyboard on the desk in front of whoever sits at `s`, `top` its row. */
    function drawKeyboard(s, top) {
      fill(s.x - 5, top, 10, 2, PALETTE.keyboard);
      fill(s.x - 4, top, 8, 1, PALETTE.keys);
    }

    /** The standard desk's top and front, in its finish or its effort's paint. */
    function drawDeskBody({ x, y, s, tint, finish }) {
      fill(x, y, DESK_WIDTH, 1, tint(finish.edge, 1));
      fill(x, y + 1, DESK_WIDTH, 4, tint(finish.top, 0.9));
      fill(x + 9, y + 1, 7, 1, PALETTE.monitorStand);
      fill(x, y + 5, DESK_WIDTH, 11, tint(finish.front, 0.72));
      fill(x, y + 5, DESK_WIDTH, 1, tint(finish.lip, 0.62));
      fill(x + 30, y + 8, 10, 6, tint(finish.drawer, 0.82));
      fill(x + 34, y + 10, 2, 1, PALETTE.handle);
      fill(x + 1, y + 16, DESK_WIDTH - 2, 1, SHADOW);
      drawKeyboard(s, y + 2);
    }

    /**
     * Each workspace's parts: its back, drawn behind whoever is at it, and
     * its front, drawn over them. Each takes the desk's corner `x`, `y`, the
     * seat `s`, `tint` for its colours (its effort's paint over them, if
     * any), the office's desk `finish`, and `occupant`, who is at it now.
     */
    const WORKSPACE_PARTS = {
      desk: {
        front(d) {
          drawMonitor(d.x + 6, d.y - 10);
          drawDeskBody(d);
        },
      },

      /** A desk raised on legs, its monitor on an arm, worked at standing up. */
      standing: {
        front({ x, y, s, tint, finish }) {
          drawMonitor(x + 6, y - 12);
          fill(x + 11, y - 1, 3, 1, PALETTE.monitorStand);
          const steel = 0x5a5f6c, foot = 0x3c404a;
          fill(x + 3, y + 5, 2, 10, steel);
          fill(x + 39, y + 5, 2, 10, steel);
          fill(x + 5, y + 9, 34, 1, foot);
          fill(x + 1, y + 15, 6, 1, foot);
          fill(x + 37, y + 15, 6, 1, foot);
          fill(x + 17, y + 5, 10, 2, foot);
          fill(x + 1, y + 16, 42, 1, SHADOW);
          fill(x, y, DESK_WIDTH, 1, tint(finish.edge, 1));
          fill(x, y + 1, DESK_WIDTH, 3, tint(finish.top, 0.9));
          fill(x, y + 4, DESK_WIDTH, 2, tint(finish.front, 0.72));
          fill(x + 9, y + 1, 7, 1, PALETTE.monitorStand);
          // The height buttons, under the top's front edge
          fill(x + 33, y + 6, 4, 1, foot);
          dot(x + 34, y + 6, 0x6fd36f);
          drawKeyboard(s, y + 2);
        },
      },

      /** A black desk with lights that cycle round the colour wheel, a racing chair and a tower under it. */
      gaming: {
        back({ s, y }) {
          const shell = 0x1d1f25, red = 0xd4140b;
          fill(s.x - 4, y - 15, 9, 15, shell);
          fill(s.x - 6, y - 8, 13, 7, shell);
          fill(s.x - 6, y - 8, 2, 7, red);
          fill(s.x + 5, y - 8, 2, 7, red);
          fill(s.x - 2, y - 15, 5, 1, red);
          fill(s.x - 1, y - 14, 3, 1, 0x3a3d47);
        },
        front({ x, y, s, tint }) {
          drawMonitor(x + 6, y - 10);
          const glow = (i, across) => rainbow((now * 0.25 + i / across) % 1);
          for (let i = 0; i < 9; i++) dot(x + 8 + i, y - 3, glow(i, 9));
          fill(x, y, DESK_WIDTH, 1, tint(0x4a4e5a, 1));
          fill(x, y + 1, DESK_WIDTH, 4, tint(0x2a2d35, 0.9));
          fill(x + 9, y + 1, 7, 1, PALETTE.monitorStand);
          fill(x + 18, y + 1, 24, 3, 0x14161b);
          fill(x, y + 5, DESK_WIDTH, 3, tint(0x1f2228, 0.72));
          for (let i = 0; i < DESK_WIDTH - 2; i++) dot(x + 1 + i, y + 7, glow(i, DESK_WIDTH - 2));
          // Legs bent like a Z, and the tower, its fans lit
          fill(x + 2, y + 8, 3, 7, 0x1d1f25);
          fill(x + 1, y + 14, 7, 1, 0xd4140b);
          fill(x + 30, y + 8, 10, 8, 0x1d1f25);
          fill(x + 31, y + 9, 8, 6, 0x14161b);
          for (const [fy, i] of [[10, 0], [13, 3]]) {
            fill(x + 33, y + fy, 3, 2, glow(i, 6));
            dot(x + 34, y + fy, 0x14161b);
          }
          fill(x + 41, y + 8, 2, 7, 0x1d1f25);
          fill(x + 1, y + 16, 42, 1, SHADOW);
          drawKeyboard(s, y + 2);
          for (let i = 0; i < 8; i++) dot(s.x - 4 + i, y + 2, glow(i, 8));
        },
      },

      /**
       * A tent, its flaps tied back, a lantern swinging from its ridge, and
       * whoever works in it in its doorway, a laptop on their knees. Its
       * canvas takes the effort's paint.
       */
      tent: {
        back({ x, y, tint }) {
          const canvas = 0x6f8a4a, cx = x + 29, peak = y - 24, base = y + 6;
          // Guy ropes out to their pegs
          for (let k = 0; k < 7; k++) {
            dot(x + 12 - k, y - 6 + k + (k > 4 ? 1 : 0), 0xc9c3b8, 0.7);
            dot(x + 46 + k, y - 6 + k + (k > 4 ? 1 : 0), 0xc9c3b8, 0.7);
          }
          fill(x + 4, y + 2, 2, 1, PALETTE.frame);
          fill(x + 53, y + 2, 2, 1, PALETTE.frame);
          fill(cx - 17, base + 1, 35, 1, SHADOW);
          for (let row = peak; row <= base; row++) {
            const half = Math.round(((row - peak) * 17) / 30);
            fill(cx - half, row, half * 2 + 1, 1, tint(canvas, 1));
            dot(cx - half, row, tint(canvas, 1.25));
            dot(cx + half, row, tint(canvas, 0.8));
            // The way in, dark inside
            const inner = row >= y - 20 ? Math.round(((row - (y - 20)) * 11) / 26) + 1 : -1;
            if (inner >= 0) fill(cx - inner, row, inner * 2 + 1, 1, tint(canvas, 0.35));
          }
          fill(cx, peak, 1, 4, tint(canvas, 1.25));
          // A groundsheet, out in front
          fill(cx - 13, base, 27, 1, tint(canvas, 0.6));
          // The lantern, swinging on its cord, lit
          const swing = Math.round(Math.sin(now * 1.6));
          dot(cx, y - 20, PALETTE.frame);
          dot(cx + swing, y - 19, PALETTE.frame);
          fill(cx - 1 + swing, y - 18, 3, 3, PALETTE.brass);
          dot(cx + swing, y - 17, 0xfff0b0);
          fill(cx - 4 + swing, y - 20, 9, 8, 0xffd36b, 0.12);
        },
        front({ x, y, s, tint, occupant }) {
          const canvas = 0x6f8a4a, cx = x + 29;
          // The flaps, rolled and tied either side of the way in
          for (let row = y - 8; row <= y + 5; row++) {
            const inner = Math.round(((row - (y - 20)) * 11) / 26) + 1;
            fill(cx - inner - 1, row, 2, 1, tint(canvas, 1.15));
            fill(cx + inner, row, 2, 1, tint(canvas, 1.15));
          }
          fill(cx - 10, y - 2, 2, 1, 0xc9c3b8);
          fill(cx + 9, y - 2, 2, 1, 0xc9c3b8);
          // Their feet, either side of the laptop, while they sit
          if (occupant && poseOf(occupant, now).kind === 'sit') {
            const outfit = outfitOf(occupant.session.agent, occupant.session.model, memberOf(occupant.session));
            fill(s.x - 5, y + 5, 3, 2, outfit.shoes);
            fill(s.x + 3, y + 5, 3, 2, outfit.shoes);
          }
          drawLaptop(x + 22, y - 3);
        },
      },

      /** A cardboard box for a desk, its flaps open, and another for a stool. */
      box: {
        back({ s, y, tint }) {
          fill(s.x - 4, y - 6, 9, 7, tint(0xa07a4a, 0.82));
          fill(s.x - 4, y - 6, 9, 1, tint(0xc9a06a, 1));
          fill(s.x, y - 6, 1, 7, 0xe0cfa0);
        },
        front({ x, y, s, tint }) {
          const face = 0xb58a55, top = 0xc9a06a, ink = 0x6e5233;
          fill(x - 2, y + 1, 3, 3, tint(top, 0.95));
          fill(x + 43, y + 1, 3, 3, tint(top, 0.95));
          fill(x + 1, y, 42, 1, tint(0xdcb78c, 1));
          fill(x + 1, y + 1, 42, 4, tint(top, 0.9));
          fill(x + 1, y + 5, 42, 11, tint(face, 0.72));
          fill(x + 1, y + 5, 42, 1, tint(0x8c6744, 0.62));
          fill(x + 40, y + 5, 3, 11, tint(0x8c6744, 0.62));
          // Tape down the middle, arrows for this way up, and a glass for fragile
          fill(x + 20, y, 4, 16, 0xe0cfa0, 0.75);
          for (const ax of [x + 6, x + 11]) {
            dot(ax, y + 8, ink);
            fill(ax - 1, y + 9, 3, 1, ink);
            fill(ax, y + 10, 1, 3, ink);
          }
          fill(x + 31, y + 8, 5, 3, ink);
          fill(x + 32, y + 11, 3, 1, ink);
          fill(x + 33, y + 12, 1, 2, ink);
          fill(x + 31, y + 14, 5, 1, ink);
          fill(x + 2, y + 16, 41, 1, SHADOW);
          drawLaptop(x + 6, y - 9);
          // A keyboard of its own in front of whoever sits there, the laptop being out of reach
          fill(s.x - 4, y + 1, 9, 2, 0x3a3d47);
          fill(s.x - 3, y + 1, 7, 1, 0x5a5f6c);
        },
      },

      /** A beanbag on a round rug, a laptop on the lap of whoever sinks into it. */
      beanbag: {
        back({ x, y, tint }) {
          const rug = 0x4a5a7a;
          fill(x + 10, y + 9, 34, 6, rug);
          fill(x + 13, y + 8, 28, 1, rug);
          fill(x + 13, y + 15, 28, 1, rug);
          fill(x + 12, y + 10, 30, 4, lighter(rug), 0.25);
          const bag = 0xc0584a;
          fill(x + 21, y - 10, 14, 1, tint(bag, 1.1));
          fill(x + 19, y - 9, 18, 1, tint(bag, 1.05));
          fill(x + 18, y - 8, 20, 12, tint(bag, 1));
          fill(x + 18, y - 8, 1, 1, tint(bag, 0.8));
          fill(x + 37, y - 8, 1, 1, tint(bag, 0.8));
          fill(x + 21, y - 9, 4, 1, WHITE, 0.25);
          fill(x + 34, y - 7, 3, 10, tint(bag, 0.85));
        },
        front({ x, y, s, tint, occupant }) {
          const bag = 0xc0584a;
          fill(x + 17, y + 1, 22, 7, tint(bag, 1.1));
          fill(x + 18, y + 8, 20, 2, tint(bag, 0.8));
          fill(x + 17, y + 1, 1, 1, tint(bag, 0.8));
          fill(x + 38, y + 1, 1, 1, tint(bag, 0.8));
          fill(x + 18, y + 10, 21, 1, SHADOW);
          // Legs out in front, crossed at the ankles, while they sit
          if (occupant && poseOf(occupant, now).kind === 'sit') {
            const outfit = outfitOf(occupant.session.agent, occupant.session.model, memberOf(occupant.session));
            fill(s.x - 3, y + 2, 7, 3, outfit.pants);
            fill(s.x - 4, y + 5, 3, 2, outfit.shoes);
            fill(s.x + 2, y + 5, 3, 2, outfit.shoes);
          }
          drawLaptop(x + 22, y - 4);
        },
      },

      /** An igloo of snow blocks, and a desk cut from ice, snow drifting down. */
      igloo: {
        back({ x, y }) {
          const snow = 0xe8f0f6, joint = 0xc4d2de, cx = x + 28, base = y + 4;
          for (let row = y - 19; row <= base; row++) {
            const t = (base - row) / 23, half = Math.round(18 * Math.sqrt(Math.max(0, 1 - t * t)));
            fill(cx - half, row, half * 2 + 1, 1, (base - row) % 5 === 0 ? joint : snow);
            fill(cx + half - 2, row, 3, 1, 0xd2dee8);
            if ((base - row) % 5 !== 0) {
              const course = Math.floor((base - row) / 5);
              for (let jx = cx - half + ((course % 2) * 4) + 3; jx < cx + half - 1; jx += 8) dot(jx, row, joint);
            }
          }
          // The way in, an arch
          for (let row = y - 14; row <= base; row++) {
            const half = [3, 5, 6][row - (y - 14)] ?? 6;
            fill(cx - half, row, half * 2 + 1, 1, 0x2a3a52);
          }
          fill(cx - 7, y - 14, 15, 1, 0xf8fbfd, 0.6);
          for (let k = 0; k < 4; k++) {
            const fall = (now * 5 + k * 6.5) % 26;
            dot(x + [6, 18, 36, 44][k], y - 22 + Math.round(fall), WHITE, 0.85 * (1 - fall / 26));
          }
        },
        front({ x, y, s, tint }) {
          drawMonitor(x + 6, y - 10);
          fill(x, y, DESK_WIDTH, 1, tint(0xf4fbfe, 1));
          fill(x, y + 1, DESK_WIDTH, 4, tint(0xcfe6f2, 0.9));
          fill(x + 9, y + 1, 7, 1, PALETTE.monitorStand);
          fill(x, y + 5, DESK_WIDTH, 11, tint(0x9fc8dc, 0.72));
          fill(x, y + 5, DESK_WIDTH, 1, tint(0x86b4cc, 0.62));
          // Light caught in the ice
          for (const [sx, sy] of [[5, 7], [22, 9], [34, 6]]) {
            for (let k = 0; k < 4; k++) dot(x + sx + k, y + sy + 4 - k, WHITE, 0.45);
          }
          fill(x + 1, y + 16, 42, 1, SHADOW);
          drawKeyboard(s, y + 2);
        },
      },

      /**
       * A camper van, its side hatch propped up as an awning over a counter,
       * fairy lights under it, and whoever works in it seen through the hatch.
       */
      van: {
        back({ x, y }) {
          fill(x + 9, y - 14, 33, 15, 0x3a2f2a);
          fill(x + 9, y - 14, 33, 2, 0x2a221e);
          fill(x + 36, y - 11, 5, 1, 0x6b4e37);
          fill(x + 36, y - 13, 2, 2, PALETTE.mug);
        },
        front({ x, y, tint }) {
          const cream = 0xece4cf, paint = 0x4f9a9a;
          fill(x, y - 21, 44, 1, cream);
          fill(x - 2, y - 20, 49, 6, cream);
          fill(x - 2, y - 14, 11, 15, cream);
          fill(x + 42, y - 14, 5, 15, cream);
          // The cab's window, the counter and the paint below it
          fill(x - 1, y - 13, 8, 7, 0x9fc8dc);
          fill(x, y - 12, 2, 4, WHITE, 0.4);
          fill(x + 7, y, 37, 2, PALETTE.deskTop);
          fill(x + 7, y + 2, 37, 1, PALETTE.deskFront);
          fill(x - 2, y + 1, 9, 2, cream);
          fill(x + 44, y + 1, 3, 2, cream);
          fill(x - 2, y + 3, 49, 9, tint(paint, 0.85));
          fill(x - 2, y + 3, 49, 1, tint(paint, 1.1));
          fill(x - 2, y + 7, 3, 2, 0xf2d35b);
          fill(x + 44, y + 7, 3, 2, 0xd04a4a);
          fill(x + 19, y + 5, 1, 6, tint(paint, 0.6));
          // Wheels
          for (const wx of [x + 3, x + 33]) {
            fill(wx, y + 10, 9, 6, 0x1d1f25);
            fill(wx - 1, y + 11, 11, 4, 0x1d1f25);
            fill(wx + 3, y + 12, 3, 2, 0xc9c3b8);
          }
          fill(x - 2, y + 16, 49, 1, SHADOW);
          // The awning, striped, and its fairy lights
          fill(x + 7, y - 18, 37, 3, 0xd96a5a);
          for (let k = 0; k < 37; k += 6) fill(x + 7 + k, y - 18, 3, 3, 0xf4f1ea);
          fill(x + 7, y - 15, 37, 1, SHADOW);
          for (let k = 0; k < 8; k++) {
            const lit = (Math.floor(now * 1.5) + k) % 3 !== 0;
            dot(x + 11 + k * 4, y - 14 + (k % 2), [0xf2d35b, 0xff8a3d, 0x6fd36f, 0x8fc0e8][k % 4], lit ? 1 : 0.3);
          }
          drawMonitor(x + 11, y - 10);
        },
      },

      /** A spaceship's cockpit: a console of lights, a pilot's seat, a canopy of glass and a blinking aerial. */
      cockpit: {
        back({ s, y }) {
          fill(s.x - 5, y - 15, 11, 15, 0x3a3f4a);
          fill(s.x - 5, y - 15, 1, 15, 0x8a93a3);
          fill(s.x + 5, y - 15, 1, 15, 0x8a93a3);
          fill(s.x - 3, y - 14, 7, 3, 0x2a2e36);
        },
        front({ x, y, s, tint }) {
          const hull = 0x5a6270, cx = x + 28, glass = 0x9fe6f2;
          // The canopy, a bubble round the seat
          for (let row = y - 20; row <= y; row++) {
            const t = (y - row) / 20, half = Math.round(14 * Math.sqrt(Math.max(0, 1 - t * t)));
            fill(cx - half, row, half * 2 + 1, 1, glass, 0.1);
            dot(cx - half, row, glass, 0.75);
            dot(cx + half, row, glass, 0.75);
            if (row === y - 20) fill(cx - half, row, half * 2 + 1, 1, glass, 0.75);
          }
          for (let k = 0; k < 6; k++) dot(cx - 9 + Math.round(k * 0.8), y - 17 + k, WHITE, 0.5);
          fill(cx, y - 23, 1, 3, 0x8a93a3);
          dot(cx, y - 24, PALETTE.alarm, Math.floor(now * 1.5) % 2 ? 1 : 0.25);
          drawMonitor(x + 6, y - 10);
          fill(x + 6, y - 11, 13, 1, 0x4ad4e8, 0.8);
          // The console, its lights blinking in turn
          fill(x, y, DESK_WIDTH, 1, tint(0x8a93a3, 1));
          fill(x, y + 1, DESK_WIDTH, 4, tint(hull, 0.9));
          fill(x, y + 5, DESK_WIDTH, 11, tint(0x3a3f4a, 0.72));
          fill(x, y + 5, DESK_WIDTH, 1, tint(0x2a2e36, 0.62));
          const lights = [0x6fd36f, 0xf2d35b, 0xd96a5a, 0x4ad4e8];
          for (let i = 0; i < 7; i++) {
            const on = (Math.floor(now * 3) + i * 5) % 7 < 4;
            dot(x + 2 + i * 2, y + 2 + (i % 2), lights[i % 4], on ? 1 : 0.35);
            dot(x + 35 + (i % 4) * 2, y + 2 + Math.floor(i / 4), lights[(i + 1) % 4], on ? 0.35 : 1);
          }
          for (let k = 0; k < 10; k++) fill(x + 3 + k * 4, y + 13, 2, 2, k % 2 ? PALETTE.hazard : PALETTE.machine);
          fill(x + 4, y + 8, 12, 3, 0x1d1f25);
          fill(x + 5, y + 9, Math.round(5 + Math.sin(now * 2) * 5), 1, 0x4ad4e8);
          fill(x + 1, y + 16, 42, 1, SHADOW);
          drawKeyboard(s, y + 2);
          fill(s.x + 8, y - 2, 1, 3, PALETTE.frame);
          dot(s.x + 8, y - 3, PALETTE.alarm);
        },
      },

      /** The deck of a pirate ship: a barrel to sit on, the Jolly Roger flying, and a wheel that turns while they work. */
      ship: {
        back({ x, y, s }) {
          // The flag, on its staff at the stern
          fill(x + 1, y - 23, 1, 23, 0x5a3b25);
          dot(x + 1, y - 24, PALETTE.brass);
          const wave = Math.floor(now * 3) % 2;
          for (let c = 0; c < 9; c++) fill(x + 2 + c, y - 23 + (c > 1 && (c + wave) % 2 ? 1 : 0), 1, 6, 0x1a1a1f);
          fill(x + 5, y - 22, 3, 2, WHITE);
          dot(x + 5, y - 19, WHITE);
          dot(x + 7, y - 19, WHITE);
          // The barrel they sit on
          fill(s.x - 4, y - 6, 9, 10, 0x7a5232);
          fill(s.x - 4, y - 6, 9, 1, 0x8c6744);
          fill(s.x - 4, y - 4, 9, 1, 0x3a3a40);
          fill(s.x - 4, y, 9, 1, 0x3a3a40);
        },
        front({ x, y, tint, occupant }) {
          drawMonitor(x + 6, y - 10);
          const hull = 0x6b4a2e;
          // The rail on its posts, and the hull below, curving in at the keel
          fill(x - 1, y, 46, 1, 0xa87a56);
          fill(x - 1, y + 1, 46, 1, 0x8c6744);
          fill(x - 1, y + 2, 46, 3, 0x2a1d16);
          for (let k = 0; k < 12; k++) fill(x + 1 + k * 4, y + 2, 1, 3, 0x8c6744);
          fill(x - 1, y + 5, 46, 1, 0x4a301e);
          fill(x - 1, y + 6, 46, 8, tint(hull, 0.8));
          fill(x + 1, y + 14, 42, 1, tint(hull, 0.65));
          fill(x + 4, y + 15, 36, 1, tint(hull, 0.55));
          for (const py of [8, 11]) fill(x - 1, y + py, 46, 1, tint(hull, 0.6));
          // Portholes, ringed in brass
          for (const px of [x + 6, x + 32]) {
            fill(px, y + 7, 4, 4, PALETTE.brass);
            fill(px + 1, y + 8, 2, 2, 0x2f7fb0);
          }
          fill(x + 2, y + 16, 40, 1, SHADOW);
          // The wheel, turning while someone works at it
          const cx = x + 39, cy = y - 5;
          const working = occupant && occupant.session.state === 'thinking';
          const turn = working ? now * 1.2 : 0.3;
          fill(cx - 1, y - 1, 3, 2, 0x5a3b25);
          for (let k = 0; k < 8; k++) {
            const a = turn + (k * Math.PI) / 4;
            for (let r = 1; r <= 6; r++) dot(cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r), r > 4 ? 0xc49a6c : 0x6b4e37);
          }
          for (let k = 0; k < 24; k++) {
            const a = (k * Math.PI) / 12;
            dot(cx + Math.round(Math.cos(a) * 4), cy + Math.round(Math.sin(a) * 4), 0xa87a56);
          }
          fill(cx - 1, cy - 1, 3, 3, PALETTE.brass);
        },
      },

      /** A throne of gold and red velvet, a jewel glinting on top, at a desk trimmed in gold. Whoever sits in it wears a crown. */
      throne: {
        back({ x, y }) {
          const gold = 0xd6b25e, velvet = 0x9a2a3a;
          fill(x + 25, y - 22, 7, 1, gold);
          fill(x + 21, y - 21, 15, 25, gold);
          fill(x + 23, y - 18, 11, 22, velvet);
          fill(x + 23, y - 18, 11, 1, shaded(velvet, 0.7));
          dot(x + 21, y - 23, gold);
          dot(x + 35, y - 23, gold);
          fill(x + 19, y - 4, 3, 2, gold);
          fill(x + 35, y - 4, 3, 2, gold);
          fill(x + 27, y - 21, 3, 2, 0xd4140b);
          dot(x + 28, y - 22, WHITE, 0.4 + 0.6 * Math.max(0, Math.sin(now * 2.2)));
        },
        front(d) {
          const { x, y, s, occupant } = d;
          drawMonitor(x + 6, y - 10);
          drawDeskBody(d);
          fill(x, y + 5, DESK_WIDTH, 1, PALETTE.brass);
          fill(x + 30, y + 8, 10, 1, PALETTE.brass);
          fill(x + 34, y + 10, 2, 1, PALETTE.brass);
          if (!occupant) return;
          const top = topOf(occupant, poseOf(occupant, now));
          fill(s.x - 2, top - 2, 5, 1, PALETTE.brass);
          for (const dx of [-2, 0, 2]) dot(s.x + dx, top - 3, PALETTE.brass);
          dot(s.x, top - 2, 0xd4140b);
        },
      },

      /** A greenhouse of glass, plants hanging from its roof and potted along its sides, a potting bench in front. */
      greenhouse: {
        back({ x, y }) {
          const bar = 0xe8ece6, cx = x + 29;
          fill(x + 13, y - 14, 33, 18, 0xa8d8b0, 0.16);
          for (let row = y - 23; row < y - 14; row++) {
            const half = Math.round(((row - (y - 23)) * 16) / 9);
            fill(cx - half, row, half * 2 + 1, 1, 0xa8d8b0, 0.16);
          }
          for (const bx of [x + 21, x + 37]) fill(bx, y - 14, 1, 18, bar, 0.5);
          // Vines from the roof, swaying, and pots along the walls
          for (const [vx, length, phase] of [[x + 16, 9, 0], [x + 42, 7, 1.3], [x + 33, 5, 2.1]]) {
            for (let k = 0; k < length; k++) {
              const sway = k > 2 ? Math.round(Math.sin(now * 1.2 + phase + k * 0.4) * 0.8) : 0;
              dot(vx + sway, y - 14 + k, k % 2 ? PALETTE.leafDark : PALETTE.leaf);
            }
          }
          for (const [px, flower] of [[x + 15, 0xf28fb0], [x + 40, 0xf2d35b]]) {
            fill(px, y - 2, 4, 3, PALETTE.pot);
            fill(px - 1, y - 8, 6, 6, PALETTE.leaf);
            fill(px, y - 9, 4, 1, PALETTE.leafDark);
            dot(px + 1, y - 6, PALETTE.leafDark);
            dot(px, y - 8, flower);
            dot(px + 3, y - 6, flower);
          }
          // A hanging basket, in flower
          fill(cx + 7, y - 21, 1, 3, PALETTE.frame);
          fill(cx + 5, y - 18, 5, 2, PALETTE.pot);
          fill(cx + 4, y - 19, 7, 1, PALETTE.leaf);
          dot(cx + 6, y - 20, 0xf28fb0);
          dot(cx + 9, y - 20, 0xf2d35b);
        },
        front(d) {
          const { x, y } = d, bar = 0xe8ece6, cx = x + 29;
          // The frame, over the panes either side of the open door
          fill(x + 13, y - 14, 1, 18, bar);
          fill(x + 45, y - 14, 1, 18, bar);
          fill(x + 13, y - 14, 33, 1, bar);
          for (let row = y - 23; row < y - 14; row++) {
            const half = Math.round(((row - (y - 23)) * 16) / 9);
            dot(cx - half, row, bar);
            dot(cx + half, row, bar);
          }
          fill(cx, y - 23, 1, 9, bar, 0.6);
          fill(x + 14, y - 13, 7, 17, 0xcfeee0, 0.18);
          fill(x + 38, y - 13, 7, 17, 0xcfeee0, 0.18);
          fill(x + 15, y - 12, 1, 4, WHITE, 0.5);
          drawMonitor(x + 4, y - 10);
          drawDeskBody(d);
          // Seedlings in a tray on the bench
          fill(x + 19, y + 1, 9, 2, 0x5a3b25);
          for (let k = 0; k < 4; k++) dot(x + 20 + k * 2, y, PALETTE.leaf);
        },
      },
    };

    /** The back of a desk's workspace, behind whoever is at it. */
    function drawWorkspaceBack(desk) {
      const kind = workspaceOf(sessionAt(desk));
      if (WORKSPACE_PARTS[kind].back) WORKSPACE_PARTS[kind].back(workspaceAt(desk));
    }

    /**
     * How a desk's workspace is drawn: where it is, its colours (painted for
     * its session's effort, from white for low to red for max, plain when
     * there's none, flashing as the button goes down) and who is at it.
     */
    function workspaceAt(desk) {
      const { x, y } = DESKS[desk];
      let paint = EFFORT_PAINT[office.deskEffort(desk)] ?? null;
      if (blast && blast.desk === desk && sinceBlast >= 0 && sinceBlast < 1.2 && Math.floor(sinceBlast * 6) % 2 === 0) paint = WHITE;
      return {
        x, y, s: seat(desk),
        tint: (plain, shade) => (paint === null ? plain : shaded(paint, shade)),
        finish: DESK_FINISHES[decor.desk],
        occupant: occupantOf(desk),
      };
    }

    /** Something on a desk whose corner is at `x`, `y`: a plant, papers, a lamp, or what you've put on it. */
    function drawDeskThing(thing, x, y) {
      if (thing === 'plant') {
        fill(x + 38, y - 2, 3, 3, PALETTE.pot);
        fill(x + 37, y - 5, 5, 3, PALETTE.leaf);
        dot(x + 39, y - 6, PALETTE.leafDark);
      } else if (thing === 'papers') {
        fill(x + 35, y + 1, 6, 3, PALETTE.paper);
        fill(x + 36, y + 2, 4, 1, PALETTE.counterTop);
      } else if (thing === 'lamp') {
        fill(x + 39, y - 6, 1, 6, PALETTE.frame);
        fill(x + 36, y - 7, 5, 2, PALETTE.brass);
        fill(x + 37, y, 5, 1, PALETTE.frame);
      } else if (thing === 'cactus') {
        fill(x + 38, y - 2, 3, 3, PALETTE.pot);
        fill(x + 39, y - 7, 1, 5, DESK_THINGS.cactus);
        dot(x + 38, y - 5, DESK_THINGS.cactus);
        dot(x + 40, y - 4, DESK_THINGS.cactus);
      } else if (thing === 'duck') {
        fill(x + 36, y - 2, 4, 2, DESK_THINGS.duck);
        fill(x + 38, y - 4, 2, 2, DESK_THINGS.duck);
        dot(x + 40, y - 3, DESK_THINGS.beak);
      } else if (thing === 'trophy') {
        fill(x + 36, y - 6, 5, 3, PALETTE.brass);
        dot(x + 38, y - 3, PALETTE.brass);
        fill(x + 37, y - 2, 3, 2, darker(PALETTE.brass));
      } else if (thing === 'photo') {
        fill(x + 36, y - 6, 5, 6, PALETTE.frame);
        fill(x + 37, y - 5, 3, 3, DESK_THINGS.sky);
        fill(x + 37, y - 3, 3, 1, PALETTE.leaf);
      } else if (thing === 'mug') {
        fill(x + 37, y - 3, 3, 3, PALETTE.mug);
        dot(x + 40, y - 2, PALETTE.mug);
        fill(x + 37, y - 3, 3, 1, DESK_THINGS.coffee);
      }
    }

    function drawDesk(desk) {
      const { x, y } = DESKS[desk], s = seat(desk);
      const kind = workspaceOf(sessionAt(desk)), workspace = WORKSPACES[kind];
      WORKSPACE_PARTS[kind].front(workspaceAt(desk));

      // Something different on each desk, or what you've put on it
      const member = memberOf(sessionAt(desk));
      const thing = member && member.desk !== 'auto' ? member.desk : ['plant', 'papers', 'lamp'][desk % 3];
      if (workspace.things) drawDeskThing(thing, x + workspace.things.dx, y + workspace.things.dy);

      const occupant = occupantOf(desk);
      if (!occupant) return;
      const skin = lookFor(occupant).skin;
      const tool = occupant.session.state === 'thinking' ? toolKind(occupant.session.tool) : null;
      if (tool === 'web') {
        // A little globe at the end of the desk, turning, moved as what's on the desk is
        const turn = Math.floor(now * 4) % 5;
        const { dx, dy } = workspace.things || { dx: 0, dy: 0 }, gx = x + dx, gy = y + dy;
        fill(gx + 2, gy - 5, 3, 1, PALETTE.sea);
        fill(gx + 1, gy - 4, 5, 3, PALETTE.sea);
        fill(gx + 2, gy - 1, 3, 1, PALETTE.sea);
        fill(gx + 1 + turn, gy - 4, 1, 2, PALETTE.leaf);
        dot(gx + 1 + ((turn + 2) % 5), gy - 2, PALETTE.leaf);
        dot(gx + 3, gy, PALETTE.frame);
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

    /** The office's chair, at a workspace that has one. */
    function drawChair(desk) {
      if (!WORKSPACES[workspaceOf(sessionAt(desk))].chair) return;
      const s = seat(desk), y = DESKS[desk].y;
      // A rounded back, lower than the monitor beside it
      const [chair, chairTop] = CHAIRS[decor.chair];
      fill(s.x - 3, y - 7, 7, 1, chairTop);
      fill(s.x - 4, y - 6, 9, 6, chair);
      fill(s.x - 4, y - 6, 1, 6, chairTop);
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

    /**
     * A dragon asleep on its hoard: its breath lifts its back, smoke curls
     * from its nose, and the gold glints. Someone come to look wakes one eye.
     */
    function drawDragon() {
      const scale = 0x3f8a5a, dark = 0x2c6a44, belly = 0xe8c87a, gold = 0xf2c94c, deep = 0xc9952a;
      const watched = atCorner(0), breath = Math.sin(now * 1.3) > 0.2 ? 1 : 0;
      // The hoard, a mound of coins
      fill(253, 96, 50, 1, SHADOW);
      for (let row = 84; row <= 95; row++) {
        const half = Math.round(24 * Math.sqrt((row - 83) / 12));
        fill(278 - half, row, half * 2, 1, gold);
        for (let k = (row % 3) * 2; k < half * 2; k += 5) dot(278 - half + k, row, deep);
      }
      fill(256, 93, 5, 3, PALETTE.brass);
      dot(258, 92, 0xd4140b);
      fill(296, 91, 4, 2, 0x8fc0e8);
      // The tail, round the front of the hoard to its tip
      for (const [tx, ty] of [[292, 86], [295, 88], [297, 90], [298, 92], [296, 93], [293, 94]]) fill(tx, ty, 3, 2, scale);
      fill(290, 94, 3, 2, dark);
      dot(289, 93, dark);
      // The body, curled on top, rising as it breathes, and the wings folded on it
      fill(267, 77 - breath, 26, 10 + breath, scale);
      fill(265, 79 - breath, 2, 7 + breath, scale);
      fill(293, 79 - breath, 2, 7, scale);
      fill(268, 84, 22, 3, belly);
      for (let k = 0; k < 5; k++) dot(270 + k * 4, 85, deep);
      fill(271, 72 - breath, 14, 5, dark);
      fill(273, 70 - breath, 8, 2, dark);
      fill(276, 69 - breath, 3, 1, dark);
      for (let k = 0; k < 6; k++) dot(268 + k * 4, 76 - breath, 0xd96a5a);
      // The neck down to the head, resting on the gold, nose to the left
      fill(259, 80, 9, 5, scale);
      fill(250, 81, 11, 6, scale);
      fill(248, 83, 3, 4, scale);
      fill(250, 86, 11, 1, belly);
      dot(249, 83, PALETTE.frame);
      fill(256, 78, 1, 3, belly);
      fill(259, 77, 1, 3, belly);
      if (watched) {
        fill(253, 82, 3, 2, 0xf2d35b);
        dot(254, 82, PALETTE.frame);
        dot(254, 83, PALETTE.frame);
      } else {
        fill(253, 83, 3, 1, dark);
      }
      // Smoke from its nose, puff after puff, quicker when it's awake
      const puffs = watched ? 3 : 2;
      for (let k = 0; k < puffs; k++) {
        const rise = (now * (watched ? 0.5 : 0.3) + k / puffs) % 1;
        const size = 1 + Math.round(rise * 2);
        fill(247 - Math.round(rise * 5), 82 - Math.round(rise * 14), size, size, PALETTE.smoke, 0.7 * (1 - rise));
      }
      // Coins catching the light, one after another
      for (let k = 0; k < 4; k++) {
        const glint = (now * 0.7 + k * 0.27) % 1;
        if (glint < 0.12) dot([262, 284, 272, 291][k], [90, 88, 93, 92][k], WHITE);
      }
    }

    /** A pinball table, its playfield lit: the flippers flick and the ball flies while someone plays. */
    function drawPinball() {
      const playing = atCorner(0), cabinet = 0x2b2350, trim = 0x8a5cf0;
      fill(261, 90, 27, 1, SHADOW);
      fill(263, 82, 2, 8, PALETTE.machine);
      fill(284, 82, 2, 8, PALETTE.machine);
      // The backbox, its lights chasing round the score
      fill(262, 51, 25, 13, cabinet);
      fill(262, 51, 25, 1, trim);
      fill(264, 53, 21, 7, PALETTE.doorway);
      for (let k = 0; k < 10; k++) {
        const lit = (Math.floor(now * 6) + k) % 4 === 0;
        dot(264 + k * 2, 61, lit ? 0xffd36b : 0x4a3a80);
      }
      for (let k = 0; k < 5; k++) fill(266 + k * 4, 55, 3, 3, playing ? 0xff8a3d : 0x6a3f2a);
      fill(273, 64, 3, 2, PALETTE.machine);
      // The playfield, seen from the end it's played at
      fill(261, 66, 27, 17, cabinet);
      fill(263, 67, 23, 14, 0x1d3a7a);
      fill(261, 66, 1, 17, trim);
      fill(287, 66, 1, 17, trim);
      const bumpers = [[267, 69, 0xd96a5a], [276, 68, 0xf2d35b], [281, 72, 0x6fd36f]];
      bumpers.forEach(([bx, by, colour], i) => {
        const hit = playing && (Math.floor(now * 3) + i) % 3 === 0;
        fill(bx, by, 3, 3, hit ? WHITE : colour);
      });
      fill(264, 75, 3, 1, 0x8fc0e8);
      fill(282, 75, 3, 1, 0x8fc0e8);
      const flick = playing && Math.floor(now * 2.5) % 2 === 0 ? 1 : 0;
      fill(268, 79 - flick, 4, 1, WHITE);
      fill(277, 79 - flick, 4, 1, WHITE);
      if (playing) {
        const bx = 274 + Math.round(Math.sin(now * 2.3) * 9), by = 73 + Math.round(Math.cos(now * 3.1) * 5);
        dot(bx, by, 0xe0e0e8);
      } else {
        dot(286, 79, 0xe0e0e8);
      }
      fill(261, 82, 27, 2, cabinet);
      dot(268, 82, 0xd4140b);
      dot(281, 82, 0xd4140b);
    }

    /** A jukebox, its arch of light running round the colours: while someone picks a record, it spins and notes rise. */
    function drawJukebox() {
      const playing = atCorner(0), wood = 0x7a3b2a;
      fill(263, 88, 23, 1, SHADOW);
      fill(266, 56, 17, 1, wood);
      fill(264, 57, 21, 2, wood);
      fill(263, 59, 23, 29, wood);
      // The arch of light, its colours moving round
      for (let k = 0; k < 30; k++) {
        const [ax, ay] = k < 10 ? [264, 86 - k * 2.6] : k < 20 ? [266 + (k - 10) * 1.7, 59 - Math.round(Math.sin(((k - 10) / 9) * Math.PI) * 2)] : [284, 60 + (k - 20) * 2.6];
        fill(Math.round(ax), Math.round(ay), 1, 2, rainbow((k / 30 + now * 0.3) % 1));
      }
      // The records behind glass, one turning
      fill(267, 62, 15, 9, PALETTE.doorway);
      fill(267, 62, 15, 1, WHITE, 0.25);
      const spin = playing ? Math.floor(now * 8) % 2 : 0;
      fill(271, 65, 7, 4, 0x1a1a1f);
      dot(274, 66, 0xd96a5a);
      dot(272 + spin * 4, 65 + spin * 3, 0x5a5a66);
      // The buttons, the grille and the coin slot
      for (let k = 0; k < 6; k++) dot(267 + k * 3, 73, playing && k === 2 ? 0x6fd36f : PALETTE.paper);
      for (let row = 76; row < 84; row += 2) fill(267, row, 15, 1, 0x4a2a1e);
      fill(266, 85, 17, 3, 0x5a2a1e);
      if (!playing) return;
      for (let k = 0; k < 3; k++) {
        const rise = (now * 0.45 + k / 3) % 1;
        const nx = 268 + k * 6 + Math.round(Math.sin(rise * 6 + k) * 2), ny = 57 - Math.round(rise * 5);
        const colour = [0xf2d35b, 0x8fc0e8, 0xf28fb0][k];
        fill(nx, ny, 2, 1, colour, 1 - rise);
        fill(nx + 1, ny - 3, 1, 3, colour, 1 - rise);
      }
    }

    /** A pool table: while someone's at it, the cue goes in, the white runs up the table and the rack breaks. */
    function drawPool() {
      const rail = 0x6b3a22, felt = 0x2f7a4a;
      const left = atCorner(0), right = atCorner(1);
      fill(250, 92, 52, 1, SHADOW);
      for (const lx of [252, 298]) fill(lx, 86, 3, 6, rail);
      fill(250, 72, 52, 14, rail);
      fill(253, 74, 46, 10, felt);
      fill(253, 74, 46, 1, shaded(felt, 0.7));
      fill(250, 86, 52, 2, shaded(rail, 0.7));
      for (const [px, py] of [[252, 73], [275, 73], [298, 73], [252, 84], [275, 84], [298, 84]]) fill(px, py, 2, 1, PALETTE.frame);
      // The balls: racked at one end, the white at the other
      const shot = left || right ? (now % 4) / 4 : 0;
      const toward = right && !left ? -1 : 1;
      const rack = [[285, 79], [287, 78], [287, 80], [289, 77], [289, 79], [289, 81]];
      const colours = [0xf2d35b, 0xd4140b, 0x4c8bf5, 0x1a1a1f, 0x9a6ad0, 0xe08a3a];
      const spread = shot > 0.5 ? Math.min(1, (shot - 0.5) * 3) : 0;
      rack.forEach(([bx, by], i) => {
        const sx = toward > 0 ? bx : 545 - bx;
        dot(sx + Math.round(spread * toward * ((i % 3) + 1)), by + Math.round(spread * (by - 79) * 1.5), colours[i]);
      });
      const run = shot < 0.25 ? 0 : Math.min(1, (shot - 0.25) * 4);
      const white = toward > 0 ? 262 + Math.round(run * 20) : 290 - Math.round(run * 20);
      dot(white, 79, WHITE);
      if (!left && !right) return;
      // The cue, drawn back, then in
      const back = shot < 0.2 ? Math.round((shot / 0.2) * 4) : shot < 0.25 ? 0 : 2;
      for (let k = 0; k < 14; k++) {
        const cx = toward > 0 ? white - 2 - back - k : white + 2 + back + k;
        dot(cx, 79 + Math.round(k / 5), k < 2 ? 0xeae6dc : 0xc49a6c);
      }
    }

    /** An upright piano and its bench: whoever plays has their back to the room, keys going down and notes rising. */
    function drawPiano() {
      const playing = atCorner(0), body = 0x1d1f25, shine = 0x3a3d47;
      fill(261, 82, 31, 1, SHADOW);
      fill(262, 58, 29, 2, shine);
      fill(262, 60, 29, 22, body);
      fill(263, 60, 1, 22, shine);
      // The music on its stand, and the candles
      fill(270, 62, 13, 6, PALETTE.paper);
      for (const row of [63, 65]) fill(271, row, 11, 1, 0x8a8f9c);
      fill(265, 57, 1, 3, 0xf2efe9);
      fill(287, 57, 1, 3, 0xf2efe9);
      dot(265, 56, 0xffd36b, 0.6 + 0.4 * Math.sin(now * 9));
      dot(287, 56, 0xffd36b, 0.6 + 0.4 * Math.sin(now * 7 + 1));
      // The keys, some pressed while it's played
      fill(263, 71, 27, 3, 0xf4f1ea);
      for (let k = 0; k < 9; k++) dot(264 + k * 3, 71, PALETTE.frame);
      if (playing) {
        for (let k = 0; k < 3; k++) {
          const key = (Math.floor(now * 5) * (k + 2) + k * 7) % 26;
          dot(264 + key, 73, 0xb8b3a8);
        }
      }
      fill(263, 74, 27, 1, shine);
      fill(265, 79, 3, 2, PALETTE.brass);
      fill(285, 79, 3, 2, PALETTE.brass);
      if (!playing) return;
      for (let k = 0; k < 3; k++) {
        const rise = (now * 0.5 + k / 3) % 1;
        const nx = 266 + k * 9 + Math.round(Math.sin(rise * 5 + k) * 2), ny = 57 - Math.round(rise * 5);
        fill(nx, ny, 2, 1, PALETTE.paper, 1 - rise);
        fill(nx + 1, ny - 3, 1, 3, PALETTE.paper, 1 - rise);
      }
    }

    /** The piano's bench, in front of whoever sits at it. */
    function drawPianoBench() {
      fill(268, 86, 17, 2, 0x3a3d47);
      fill(268, 88, 17, 1, 0x1d1f25);
      fill(269, 89, 2, 2, 0x1d1f25);
      fill(282, 89, 2, 2, 0x1d1f25);
      fill(267, 91, 19, 1, SHADOW);
    }

    /** A drum kit, the drummer behind it: while they play, the sticks come down and the cymbals shake. */
    function drawDrums() {
      const playing = atCorner(0), shell = 0x2f5aa8, chrome = 0xc9c3b8, brass = 0xe0b84a;
      const beat = playing ? Math.floor(now * 6) % 2 : 0;
      fill(250, 93, 54, 1, SHADOW);
      // Cymbals on their stands, shaking when hit
      for (const [cx, top, hit] of [[256, 72, beat], [298, 68, 1 - beat]]) {
        fill(cx, top + 1, 1, 93 - top - 1, chrome);
        fill(cx - 2, 92, 5, 1, chrome);
        const tilt = playing && hit ? 1 : 0;
        fill(cx - 4, top - tilt, 4, 1, brass);
        fill(cx + 1, top + tilt, 4, 1, brass);
        dot(cx, top, brass);
      }
      // The toms over the bass drum, the floor tom and the snare
      fill(260, 82, 9, 3, chrome);
      fill(260, 85, 9, 2, shell);
      fill(291, 81, 9, 3, chrome);
      fill(291, 84, 9, 7, shell);
      fill(292, 91, 1, 2, chrome);
      fill(298, 91, 1, 2, chrome);
      fill(266, 76, 8, 2, chrome);
      fill(266, 78, 8, 3, shell);
      fill(279, 76, 8, 2, chrome);
      fill(279, 78, 8, 3, shell);
      // The bass drum, its front head marked, thumping
      const thump = playing && beat ? 1 : 0;
      fill(268, 81 + thump, 17, 12 - thump, shell);
      fill(270, 82 + thump, 13, 10 - thump, 0xf2efe9);
      fill(274, 85 + thump, 5, 4, 0xd96a5a);
      fill(268, 81 + thump, 17, 1, chrome);
      if (!playing) return;
      // The sticks, coming down in turn
      const lift = [beat ? 3 : 0, beat ? 0 : 3];
      [[270, 268], [282, 286]].forEach(([hand, tip], i) => {
        for (let k = 0; k < 5; k++) dot(hand + Math.round(((tip - hand) * k) / 4), 81 - lift[i] - k + (k > 2 ? 1 : 0), 0xe9d3a0);
      });
    }

    /** A brass telescope on its tripod, aimed at the sky: it drifts while no one looks, and stars twinkle where it points. */
    function drawTelescope() {
      const looking = atCorner(0), tube = 0xe8e4da, leg = 0x6b4e37;
      fill(266, 92, 24, 1, SHADOW);
      for (const [fx, fy] of [[267, 91], [287, 91], [279, 88]]) {
        for (let k = 0; k <= 16; k++) dot(Math.round(278 + ((fx - 278) * k) / 16), Math.round(74 + ((fy - 74) * k) / 16), leg);
      }
      fill(276, 72, 5, 3, PALETTE.brass);
      // The tube, from the eyepiece up to its lens, swinging a little while no one's at it
      const drift = looking ? 0 : Math.round(Math.sin(now * 0.4) * 2);
      const from = { x: 271, y: 79 }, to = { x: 292, y: 60 + drift };
      for (let k = 0; k <= 20; k++) {
        const tx = Math.round(from.x + ((to.x - from.x) * k) / 20), ty = Math.round(from.y + ((to.y - from.y) * k) / 20);
        const band = k === 7 || k === 15;
        fill(tx - 1, ty - 1, 3, 3, band ? PALETTE.brass : tube);
        dot(tx + 1, ty + 1, 0xb8b3a8);
      }
      fill(to.x - 1, to.y - 2, 4, 4, PALETTE.brass);
      fill(to.x, to.y - 1, 2, 2, 0x1d3a7a);
      fill(from.x - 2, from.y, 3, 2, PALETTE.frame);
      // A star chart on a stand beside it
      fill(296, 80, 1, 12, leg);
      fill(292, 78, 10, 7, 0x1d3a7a);
      for (const [sx, sy] of [[294, 80], [297, 79], [299, 82], [295, 83]]) dot(sx, sy, PALETTE.paper);
      // Stars, out where it points
      for (let k = 0; k < 3; k++) {
        const t = (now * 0.6 + k * 0.33) % 1;
        if (t < 0.4) dot(to.x + 4 + k * 3, to.y - 5 - k * 2, 0xfff0b0, 1 - t / 0.4);
      }
    }

    /** A tall tank of jellyfish, glowing as they pulse up and drift down, bubbles rising past them. */
    function drawJellyfish() {
      const metal = 0x5a5f6c;
      fill(260, 91, 31, 1, SHADOW);
      fill(261, 84, 29, 7, PALETTE.counter);
      fill(263, 86, 25, 4, PALETTE.doorPanel);
      fill(262, 51, 27, 2, metal);
      fill(262, 82, 27, 2, metal);
      // The water, darker at the bottom, and the glass's shine
      for (let row = 53; row < 82; row++) fill(262, row, 27, 1, row < 64 ? 0x1a4a7a : row < 74 ? 0x153d68 : 0x0e2a4a);
      fill(263, 54, 1, 26, WHITE, 0.2);
      fill(286, 54, 1, 26, WHITE, 0.1);
      for (const [speed, phase, jx, colour] of [[0.5, 0, 268, 0xf28fb0], [0.4, 2.1, 280, 0xb88af0], [0.6, 4.2, 274, 0x8fe0f0]]) {
        const bob = Math.sin(now * speed + phase), pulse = Math.floor(now * 2 + phase) % 2;
        const y = 66 + Math.round(bob * 8), x = jx + Math.round(Math.sin(now * 0.3 + phase) * 2);
        fill(x - 3, y - 3, 7, 7, colour, 0.15);
        fill(x - 1, y - 1, 4 - pulse, 1, colour);
        fill(x - 2 + pulse, y, 6 - pulse * 2, 2, colour);
        for (let k = 0; k < 3; k++) {
          const sway = Math.round(Math.sin(now * 3 + phase + k) * 0.6);
          fill(x - 1 + k * 2 + sway, y + 2, 1, 3 + (k % 2), colour, 0.7);
        }
      }
      for (let k = 0; k < 2; k++) {
        const rise = (now * 0.4 + k / 2) % 1;
        dot(284 - k * 17, 80 - Math.round(rise * 26), WHITE, 0.6 * (1 - rise));
      }
    }

    /** A bonsai on a low stand, a stone lantern beside it: a leaf falls now and then, and a trimmer's snips glint. */
    function drawBonsai() {
      const wood = 0x5a3b25;
      fill(260, 91, 34, 1, SHADOW);
      fill(261, 80, 32, 2, 0x8c6744);
      fill(261, 82, 32, 2, wood);
      fill(263, 84, 2, 7, wood);
      fill(289, 84, 2, 7, wood);
      // The pot, the trunk twisting up, and the pads of leaves
      fill(267, 76, 18, 4, 0x4a6a8a);
      fill(266, 76, 20, 1, 0x5a7a9a);
      fill(268, 75, 16, 1, 0x3b5a3a);
      for (const [tx, ty] of [[276, 74], [276, 72], [275, 70], [274, 68], [275, 66], [277, 64]]) fill(tx, ty, 2, 2, 0x6e4a2e);
      fill(270, 69, 5, 1, 0x6e4a2e);
      fill(278, 67, 5, 1, 0x6e4a2e);
      for (const [px, py, w] of [[264, 66, 10], [279, 64, 10], [271, 60, 11]]) {
        fill(px + 1, py, w - 2, 1, PALETTE.leaf);
        fill(px, py + 1, w, 3, PALETTE.leaf);
        fill(px + 1, py + 3, w - 2, 1, PALETTE.leafDark);
        dot(px + 2, py + 1, 0x6fba6a);
      }
      // The stone lantern
      fill(288, 74, 3, 6, 0x8a8f9c);
      fill(286, 73, 7, 1, 0x9aa0a6);
      dot(289, 76, 0xffd36b, 0.8);
      // A leaf falling to the stand
      const fall = (now * 0.25) % 1;
      if (fall < 0.6) dot(283 + Math.round(Math.sin(fall * 12)), 68 + Math.round((fall / 0.6) * 11), PALETTE.leaf);
      if (atCorner(0) && Math.floor(now * 2) % 3 === 0) dot(266, 65, WHITE);
    }

    /** A jungle of plants: a palm, a monstera and a fern, their leaves stirring, and a parrot that bobs and flaps. */
    function drawJungle() {
      const leaf = PALETTE.leaf, dark = PALETTE.leafDark, light = 0x6fba6a, deep = 0x2f6a3a;
      fill(246, 93, 60, 1, SHADOW);
      const sway = (phase) => Math.round(Math.sin(now * 0.9 + phase) * 0.8);
      // The monstera, to the left, its broad leaves split
      fill(250, 86, 10, 7, PALETTE.pot);
      fill(249, 86, 12, 1, 0x8a4f32);
      for (const [lx, ly, phase] of [[244, 72, 0.5], [252, 64, 1.5], [257, 75, 2.5], [246, 80, 3.5]]) {
        const s = sway(phase);
        [3, 6, 8, 8, 7, 4].forEach((w, r) => fill(lx + s + Math.floor((8 - w) / 2), ly + r, w, 1, r < 3 ? deep : 0x285a32));
        for (let r = 1; r < 5; r++) dot(lx + s + 1 + r, ly + r, 0x3f8a4a);
        dot(lx + s + 1, ly + 2, PALETTE.wood);
        dot(lx + s + 6, ly + 3, PALETTE.wood);
        // Its stem, down to the pot
        for (let k = 0; k <= 8; k++) {
          const sy = ly + 6 + Math.round(((86 - ly - 6) * k) / 8);
          if (sy < 86) dot(Math.round(lx + 4 + s + ((255 - lx - 4 - s) * k) / 8), sy, deep);
        }
      }
      // The palm, in the middle, its fronds arching over the rest
      fill(272, 86, 9, 7, PALETTE.pot);
      fill(271, 86, 11, 1, 0x8a4f32);
      for (let k = 0; k < 8; k++) fill(275 + (k > 4 ? 1 : 0), 62 + k * 3, 3, 3, k % 2 ? 0x8a6a42 : 0x6e5233);
      for (const [dir, length, lift, phase] of [[-1, 14, 3, 0], [1, 14, 3, 1], [-1, 9, 0, 2], [1, 9, 0, 3], [-1, 6, 5, 4], [1, 6, 5, 5]]) {
        for (let k = 1; k <= length; k++) {
          const fx = 277 + dir * k, fy = 61 - lift + Math.round((k * k) / (length + 2)) + (k > length / 2 ? sway(phase) : 0);
          dot(fx, fy, leaf);
          dot(fx, fy + 1, k % 2 ? dark : leaf);
          if (k > 2 && k % 2 === 0) dot(fx, fy + 2, dark);
        }
      }
      fill(275, 59, 5, 3, leaf);
      dot(277, 58, light);
      // The fern, to the right, its fronds arching out of the pot
      fill(292, 87, 9, 6, PALETTE.pot);
      fill(291, 87, 11, 1, 0x8a4f32);
      for (let f = 0; f < 7; f++) {
        const angle = Math.PI * (1.12 + f * 0.13), s = sway(f);
        for (let k = 1; k <= 9; k++) {
          const fx = 296 + Math.round(Math.cos(angle) * k * 1.1) + (k > 5 ? s : 0);
          const fy = 86 + Math.round(Math.sin(angle) * k) + Math.round((k * k) / 22);
          dot(fx, fy, k % 3 ? leaf : light);
          if (k > 1 && k < 8) dot(fx + (k % 2 ? 1 : -1), fy + 1, dark);
        }
      }
      // The parrot on the palm, bobbing, and now and then flapping
      const px = 284, py = 63, bob = Math.floor(now * 2) % 2, flap = (now % 5) < 0.6 ? Math.floor(now * 10) % 2 : -1;
      fill(px, py - 4 + bob, 3, 3, 0xd4140b);
      dot(px + 3, py - 3 + bob, 0xf2d35b);
      dot(px + 1, py - 3 + bob, WHITE);
      fill(px, py - 1, 3, 4, 0xd4140b);
      fill(px - 1, py + 3, 2, 3, 0x4c8bf5);
      if (flap >= 0) fill(px + 3, py - 2 + flap * 2, 3, 2, 0x4c8bf5);
      else fill(px - 1, py, 2, 3, 0x4c8bf5);
      dot(px + 1, py + 3, 0xf2d35b);
    }

    /** A coffee bar, a chalkboard in front: steam from the machine, and a cup filling while the barista's in. */
    function drawCoffeeBar() {
      const wood = 0x5a3b25;
      fill(252, 93, 50, 1, SHADOW);
      // The espresso machine, chrome, on the bar
      fill(282, 63, 14, 10, 0xc9c3b8);
      fill(282, 63, 14, 1, WHITE);
      fill(284, 65, 10, 3, PALETTE.machine);
      dot(286, 66, 0x6fd36f);
      dot(291, 66, 0xd96a5a);
      fill(286, 69, 2, 2, PALETTE.machine);
      fill(291, 69, 2, 2, PALETTE.machine);
      const brewing = atCorner(0), fillUp = brewing ? (now * 0.25) % 1 : 0;
      fill(286, 72, 3, 1, PALETTE.mug);
      if (fillUp > 0) fill(286, 72, 3, 1, 0x5a3a24);
      for (let k = 0; k < 2; k++) {
        const rise = (now * 0.5 + k / 2) % 1;
        dot(292 + Math.round(Math.sin(rise * 6 + k)), 61 - Math.round(rise * 8), WHITE, 0.6 * (1 - rise));
      }
      // Cups stacked, and the bar itself
      for (let k = 0; k < 3; k++) fill(256, 70 - k * 2, 4, 2, k % 2 ? 0xe9e6df : PALETTE.mug);
      fill(262, 71, 3, 2, 0x8a5a2b);
      fill(254, 73, 46, 3, 0x8c6744);
      fill(254, 73, 46, 1, 0xa87a56);
      fill(254, 76, 46, 16, wood);
      for (let k = 0; k < 5; k++) fill(257 + k * 9, 78, 1, 13, shaded(wood, 0.8));
      fill(254, 76, 46, 1, shaded(wood, 0.7));
      // The chalkboard, standing on the floor
      fill(244, 82, 9, 10, PALETTE.counter);
      fill(245, 83, 7, 7, 0x2a2e2a);
      for (const [cx, cy, w] of [[246, 84, 5], [246, 86, 4], [246, 88, 5]]) fill(cx, cy, w, 1, PALETTE.paper, 0.75);
      fill(244, 92, 9, 1, SHADOW);
    }

    /** Two racks of servers, their lights blinking, a cable bundle over them, a red light now and then. */
    function drawServers() {
      fill(258, 89, 35, 1, SHADOW);
      const lights = [0x6fd36f, 0x6fd36f, 0xf2d35b, 0x4c8bf5];
      for (const [rx, seed] of [[259, 0], [276, 7]]) {
        fill(rx, 52, 16, 37, 0x1d1f25);
        fill(rx, 52, 16, 1, 0x3a3f4a);
        fill(rx, 52, 1, 37, 0x3a3f4a);
        fill(rx + 15, 52, 1, 37, 0x3a3f4a);
        for (let u = 0; u < 11; u++) {
          const uy = 54 + u * 3;
          fill(rx + 2, uy, 12, 2, 0x2a2e36);
          fill(rx + 9, uy, 4, 1, 0x14161b);
          for (let k = 0; k < 3; k++) {
            const on = (Math.floor(now * (3 + ((u + k + seed) % 4))) + u * 3 + k + seed) % 3 !== 0;
            dot(rx + 3 + k * 2, uy, lights[(u + k + seed) % lights.length], on ? 1 : 0.2);
          }
        }
      }
      if (Math.floor(now * 1.2) % 7 === 0) dot(288, 63, PALETTE.alarm);
      // A tray of cables along the tops, dropping into each rack
      fill(259, 50, 33, 2, 0x5a5f6c);
      [0x4c8bf5, 0xf2d35b, 0xd96a5a].forEach((colour, k) => {
        fill(261 + k * 2, 50, 1, 3, colour);
        fill(278 + k * 2, 50, 1, 3, colour);
        dot(266 + k * 6, 50, colour);
      });
    }

    /** A 3D printer on a table, its head running back and forth as the print grows layer by layer, its spool turning. */
    function drawPrinter() {
      const frame = 0x3a3f4a, rail = 0x8a93a3, filament = 0x4c8bf5;
      fill(257, 91, 42, 1, SHADOW);
      fill(258, 78, 40, 2, 0x8c6744);
      fill(258, 80, 40, 2, PALETTE.counter);
      fill(260, 82, 2, 9, PALETTE.counter);
      fill(294, 82, 2, 9, PALETTE.counter);
      // The frame and its bed
      fill(265, 56, 2, 22, frame);
      fill(286, 56, 2, 22, frame);
      fill(265, 56, 23, 2, frame);
      fill(267, 75, 19, 2, 0x2a2e36);
      // The print, growing, then taken off for the next
      const progress = (now / 30) % 1, layers = Math.min(12, Math.floor(progress * 14));
      for (let k = 0; k < layers; k++) {
        const w = k < 4 ? 9 : k < 8 ? 7 : 5;
        fill(276 - Math.floor(w / 2), 74 - k, w, 1, k % 2 ? filament : shaded(filament, 0.85));
      }
      // The gantry, at the layer it's on, and the head running along it
      const gy = 72 - layers;
      fill(267, gy, 19, 1, rail);
      const run = layers < 12 ? Math.round(Math.sin(now * 4) * 4) : 0;
      fill(274 + run, gy - 2, 5, 3, PALETTE.machine);
      dot(276 + run, gy + 1, layers < 12 ? 0xff8a3d : PALETTE.machine);
      // The spool, turning while it prints, and its little screen
      fill(290, 62, 7, 7, filament);
      fill(292, 64, 3, 3, PALETTE.paper);
      const spoke = layers < 12 ? Math.floor(now * 3) % 2 : 0;
      dot(293 + (spoke ? 1 : -1), 65, 0x9aa0a6);
      for (let k = 0; k < 6; k++) dot(289 - Math.round(k * 0.5), 66 + k, filament);
      fill(268, 79, 6, 1, PALETTE.frame);
      fill(268, 79, Math.round(progress * 6), 1, 0x6fd36f);
    }

    /** A heavy bag on its stand: it swings when it's hit, a star where the punch lands. */
    function drawBoxing() {
      const post = 0x3a3f4a, bag = 0xb8322a;
      fill(268, 93, 36, 1, SHADOW);
      fill(296, 53, 3, 39, post);
      fill(278, 53, 21, 2, post);
      fill(293, 91, 9, 2, post);
      // The bag, hung from its chain, swinging out from the top
      const hitting = atCorner(0), swing = hitting ? Math.sin(now * 5) : Math.sin(now * 0.8) * 0.15;
      fill(281, 55, 1, 5, 0x9aa0a6);
      for (let row = 0; row < 22; row++) {
        const sx = Math.round(swing * row * 0.15);
        const w = row === 0 || row === 21 ? 7 : 9;
        fill(282 - Math.ceil(w / 2) + sx, 60 + row, w, 1, row === 4 || row === 16 ? 0x2a2e36 : bag);
        if (row > 0 && row < 21) dot(282 - 4 + sx, 60 + row, lighter(bag));
      }
      if (hitting && swing > 0.85) {
        const sx = Math.round(swing * 10 * 0.15);
        for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) dot(276 + sx + dx, 70 + dy, 0xffd36b);
      }
      // A pair of dumbbells, and a towel over the stand
      fill(301, 90, 7, 1, 0x5a5f6c);
      fill(300, 89, 2, 3, PALETTE.machine);
      fill(307, 89, 2, 3, PALETTE.machine);
      fill(299, 56, 3, 7, 0xe9e6df);
    }

    /** The treadmill's console and handrails, beyond whoever walks on it. */
    function drawTreadmillConsole() {
      const grey = 0x5a5f6c;
      fill(264, 68, 2, 14, grey);
      fill(286, 68, 2, 14, grey);
      fill(262, 63, 28, 7, 0x2a2e36);
      fill(262, 63, 28, 1, grey);
      fill(265, 65, 10, 3, 0x1a3a2a);
      const running = atCorner(0);
      for (let k = 0; k < 4; k++) {
        const level = running ? 1 + ((Math.floor(now * 2) + k * 2) % 3) : 1;
        fill(266 + k * 2, 68 - level, 1, level, 0x6fd36f);
      }
      dot(279, 65, running ? 0x6fd36f : 0x5a5f6c);
      dot(282, 65, 0xd96a5a);
      dot(285, 65, 0x4c8bf5);
    }

    /** The treadmill's belt, running under whoever walks on it. */
    function drawTreadmillBelt() {
      fill(260, 93, 32, 1, SHADOW);
      fill(261, 79, 30, 4, 0x3a3f4a);
      fill(263, 83, 26, 9, 0x23252c);
      fill(261, 83, 2, 9, 0x8a93a3);
      fill(289, 83, 2, 9, 0x8a93a3);
      fill(261, 92, 30, 1, 0x5a5f6c);
      const shift = atCorner(0) ? Math.floor(now * 8) % 3 : 0;
      for (let row = 83 + shift; row < 92; row += 3) fill(263, row, 26, 1, 0x34373f);
    }

    /** A hot tub's back rim, behind whoever is in it. */
    function drawHotTubBack() {
      fill(254, 76, 46, 2, 0xa87a56);
      fill(255, 78, 44, 3, 0x7a5232);
      for (let k = 0; k < 8; k++) fill(257 + k * 6, 78, 1, 3, 0x5a3b25);
    }

    /** The hot tub's water, up to the shoulders of whoever sits in it, bubbling and steaming, a duck afloat, and the tub's front. */
    function drawHotTubFront() {
      fill(253, 96, 48, 1, SHADOW);
      fill(255, 81, 44, 6, 0x3fa0c0);
      fill(255, 81, 44, 1, 0x8fd6ea);
      for (let k = 0; k < 6; k++) {
        const t = (now * 0.9 + k * 0.37) % 1;
        dot(258 + ((k * 13) % 40), 82 + (k % 3), WHITE, t < 0.5 ? 0.8 : 0.2);
      }
      const bob = Math.round(Math.sin(now * 2));
      fill(292, 80 + bob, 4, 2, DESK_THINGS.duck);
      fill(294, 78 + bob, 2, 2, DESK_THINGS.duck);
      dot(296, 79 + bob, DESK_THINGS.beak);
      fill(253, 86, 48, 2, 0xa87a56);
      fill(254, 88, 46, 8, 0x7a5232);
      for (let k = 0; k < 8; k++) fill(256 + k * 6, 88, 1, 8, 0x5a3b25);
      fill(254, 90, 46, 1, 0x3a3a40);
      for (let k = 0; k < 3; k++) {
        const rise = (now * 0.35 + k / 3) % 1;
        fill(262 + k * 14 + Math.round(Math.sin(rise * 5 + k) * 2), 78 - Math.round(rise * 18), 2 + Math.round(rise * 2), 1, WHITE, 0.35 * (1 - rise));
      }
    }

    /** A ball pit's back wall, padded. */
    function drawBallPitBack() {
      fill(254, 75, 46, 2, 0x5a8ad0);
      fill(254, 77, 46, 7, 0x3f6aa8);
      for (let k = 0; k < 5; k++) fill(256 + k * 9, 77, 1, 7, 0x2f5a8a);
    }

    /** The balls, up to the shoulders of whoever's in, one bouncing up now and then, and the pit's front wall. */
    function drawBallPitFront() {
      const colours = [0xd4140b, 0xf2d35b, 0x4c8bf5, 0x6fd36f, 0xf28fb0, 0xe08a3a];
      fill(253, 96, 48, 1, SHADOW);
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 22; k++) fill(255 + k * 2 + (row % 2), 81 + row * 2, 2, 2, colours[(k * 7 + row * 5) % colours.length]);
      }
      const hop = (now * 0.8) % 1;
      if (hop < 0.5) {
        const h = Math.round(Math.sin(hop * 2 * Math.PI) * 6);
        fill(266 + Math.floor(now * 0.8) % 4 * 7, 80 - h, 2, 2, colours[Math.floor(now * 0.8) % colours.length]);
      }
      fill(253, 88, 48, 2, 0xd96a5a);
      fill(254, 90, 46, 6, 0xb8322a);
      for (let k = 0; k < 5; k++) fill(256 + k * 9, 90, 1, 6, 0x8a2a24);
    }

    /** A campfire in a ring of stones, flames flickering, sparks and smoke rising, a glow on the floor. */
    function drawCampfire() {
      const cx = 276;
      fill(cx - 16, 88, 33, 8, 0xff8a3d, 0.08);
      fill(cx - 10, 86, 21, 10, 0xff8a3d, 0.08);
      for (const [sx, sy] of [[266, 91], [270, 93], [276, 94], [282, 93], [286, 91], [269, 89], [283, 89]]) {
        fill(sx - 1, sy, 3, 2, 0x8a8f9c);
        dot(sx - 1, sy, 0xa8adb6);
      }
      fill(269, 90, 14, 2, 0x5a3b25);
      fill(271, 89, 10, 1, 0x6e4a2e);
      // The flames, each column its own height, red to yellow
      for (let k = 0; k < 9; k++) {
        const h = 4 + Math.round(4 * Math.abs(Math.sin(now * (5 + k) + k * 1.7))) - Math.abs(k - 4);
        if (h <= 0) continue;
        const fx = cx - 4 + k;
        fill(fx, 89 - h, 1, h, 0xd4140b);
        if (h > 2) fill(fx, 89 - h + 1, 1, h - 1, 0xff8a3d);
        if (h > 4) fill(fx, 89 - h + 3, 1, h - 3, 0xf2d35b);
      }
      for (let k = 0; k < 3; k++) {
        const rise = (now * 0.8 + k / 3) % 1;
        dot(cx - 2 + k * 2 + Math.round(Math.sin(rise * 7 + k) * 2), 82 - Math.round(rise * 14), 0xffd36b, 1 - rise);
      }
      for (let k = 0; k < 2; k++) {
        const rise = (now * 0.25 + k / 2) % 1;
        fill(cx - 1 + Math.round(Math.sin(rise * 4 + k) * 3), 76 - Math.round(rise * 20), 2 + Math.round(rise * 2), 2, PALETTE.smoke, 0.35 * (1 - rise));
      }
      // Marshmallows toasting on sticks, held out by whoever sits by it
      [[0, 259, 269], [1, 293, 283]].forEach(([i, hand, tip]) => {
        if (!atCorner(i)) return;
        for (let k = 0; k <= 8; k++) dot(Math.round(hand + ((tip - hand) * k) / 8), 85 - Math.round(k * 0.4), 0x8a6a42);
        const toast = (now * 0.1 + i * 0.5) % 1;
        fill(tip + (i ? -1 : 0), 81, 2, 2, toast < 0.5 ? 0xf4f1ea : 0xd9b26a);
      });
    }

    /** The logs either side of the fire, in front of whoever sits on them. */
    function drawCampfireLogs() {
      for (const lx of [248, 290]) {
        fill(lx, 90, 15, 4, 0x6e4a2e);
        fill(lx, 90, 15, 1, 0x8a6a42);
        fill(lx, 90, 2, 4, 0xc9a06a);
        dot(lx + 1, 91, 0x8a6a42);
        fill(lx, 94, 15, 1, SHADOW);
      }
    }

    /* The pet */

    /**
     * The pet, a few pixels high, facing the way it's going: walking, or
     * settled the way its place has it (sitting, lying, asleep, clinging).
     */
    function drawPet() {
      const pet = office.pet;
      const x = Math.round(pet.position.x), y = Math.round(pet.position.y);
      // Drawn facing right; facing left mirrors it about x.
      const p = (dx, dy, w, h, colour, alpha) => fill(pet.facing > 0 ? x + dx : x - dx - w + 1, y + dy, w, h, colour, alpha);
      const step = pet.isWalking ? Math.floor(now * 8) % 2 : 0;
      const pose = pet.isWalking ? 'walk' : pet.target ? pet.target.pose : 'sit';
      const grounded = !pet.target || !pet.target.depth || pet.isWalking;
      if (grounded) p(-4, 0, 9, 1, SHADOW);
      switch (pet.kind) {
        case 'cat': {
          const fur = 0xb8b3a8, dark = 0x77726b;
          if (pose === 'sleep') {
            p(-3, -3, 7, 3, fur);
            p(-3, -3, 7, 1, dark);
            p(3, -4, 2, 1, fur);
            const rise = (now * 0.4) % 1;
            fill(x + 3 + Math.round(rise * 2), y - 6 - Math.round(rise * 5), 2, 1, WHITE, 1 - rise);
            break;
          }
          if (pose === 'walk') {
            p(-3, -4, 6, 3, fur);
            p(2, -6, 3, 3, fur);
            p(2, -7, 1, 1, fur);
            p(4, -7, 1, 1, fur);
            p(-4, -7, 1, 3, dark);
            p(-3, -1, 1, 1, dark);
            p(1 + step, -1, 1, 1, dark);
            p(4, -5, 1, 1, PALETTE.eye);
            break;
          }
          p(-2, -5, 4, 5, fur);
          p(-1, -8, 4, 3, fur);
          p(-1, -9, 1, 1, fur);
          p(2, -9, 1, 1, fur);
          p(2, -7, 1, 1, PALETTE.eye);
          p(-4, -1, 3, 1, dark);
          p(-4, -2 - (Math.floor(now * 1.2) % 2), 1, 1, dark);
          break;
        }
        case 'dog': {
          const fur = 0x9a6a3a, dark = 0x6e4a26;
          const wag = Math.floor(now * 6) % 2;
          if (pose === 'lie') {
            p(-4, -3, 9, 3, fur);
            p(4, -5, 3, 3, fur);
            p(4, -5, 1, 3, dark);
            p(7, -4, 1, 1, PALETTE.eye);
            p(-5, -2 - wag, 1, 1, dark);
            break;
          }
          p(-4, -6, 8, 3, fur);
          p(3, -9, 4, 4, fur);
          p(3, -9, 1, 3, dark);
          p(7, -7, 1, 1, PALETTE.eye);
          p(5, -8, 1, 1, PALETTE.eye);
          p(-5, -8 - wag, 1, 2, dark);
          if (pose === 'sit') {
            p(-4, -3, 3, 3, fur);
            p(2, -3, 1, 3, dark);
          } else {
            p(-3, -3, 1, 3 - step, dark);
            p(-1, -3, 1, 2 + step, dark);
            p(1, -3, 1, 3 - step, dark);
            p(3, -3, 1, 2 + step, dark);
          }
          break;
        }
        case 'lizard': {
          const skin = 0x5aa84a, dark = 0x3d7a33;
          p(-3, -2, 6, 2, skin);
          p(3, -2, 2, 2, skin);
          p(4, -2, 1, 1, PALETTE.eye);
          p(-6, -1, 3, 1, dark);
          p(-2, 0 - step, 1, 1, dark);
          p(2, -1 + step, 1, 1, dark);
          p(-2, -3 + step, 1, 1, dark);
          p(2, -3, 1, 1, dark);
          break;
        }
        case 'monkey': {
          const fur = 0x7a5232, face = 0xd9b48a;
          p(-2, -6, 4, 5, fur);
          p(-2, -9, 4, 3, fur);
          p(-1, -8, 3, 2, face);
          p(-3, -8, 1, 1, fur);
          p(2, -8, 1, 1, fur);
          p(1, -8, 1, 1, PALETTE.eye);
          p(-3, -2, 1, 1, fur);
          p(-4, -4, 1, 3, fur);
          p(-4, -5, 2, 1, fur);
          if (pose === 'walk') {
            p(-2, -1, 1, 1 + step, fur);
            p(1, -1, 1, 2 - step, fur);
          } else {
            p(-2, -1, 4, 1, fur);
          }
          if (pet.carrying) p(2, -5, 2, 2, PALETTE.mug);
          break;
        }
      }
    }

    /** What the lounge's corner piece is made of, each part at the depth it stands at. */
    const CORNER_PARTS = {
      arcade: [[86, drawArcade]], vending: [[86, drawVending]], foosball: [[89, drawFoosball]], fishtank: [[86, drawFishTank]],
      books: [[86, drawBookcase], [90, drawBeanbagBack], [94.5, drawBeanbagFront]],
      dragon: [[96, drawDragon]], pinball: [[90, drawPinball]], jukebox: [[88, drawJukebox]], pool: [[92, drawPool]],
      piano: [[82, drawPiano], [91, drawPianoBench]], drums: [[93, drawDrums]], telescope: [[92, drawTelescope]],
      jellyfish: [[91, drawJellyfish]], bonsai: [[91, drawBonsai]], jungle: [[93, drawJungle]], coffee: [[93, drawCoffeeBar]],
      servers: [[89, drawServers]], printer: [[91, drawPrinter]], boxing: [[93, drawBoxing]],
      treadmill: [[80, drawTreadmillConsole], [88, drawTreadmillBelt]], hottub: [[80, drawHotTubBack], [89, drawHotTubFront]],
      ballpit: [[80, drawBallPitBack], [89, drawBallPitFront]], campfire: [[92.5, drawCampfire], [93, drawCampfireLogs]],
      none: [],
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
      const look = lookFor(person), away = person.isFacingAway;
      const outfit = person.isStaff
        ? { ...outfitOf(null), shirt: STAFF_SHIRTS[Math.floor(look.phase * STAFF_SHIRTS.length) % STAFF_SHIRTS.length] }
        : outfitOf(person.session.agent, person.session.model, memberOf(person.session));
      const shirtColour = outfit.shirt;
      // Sleeves are the shirt's, or a white shirt's under a waistcoat.
      const sleeve = (px, py, w, h) => {
        ctx.fillStyle = css(outfit.sleeves ?? shirtColour, 1, 0.78);
        ctx.fillRect(ox + px * scale, oy + py * scale, w * scale, h * scale);
      };

      // Legs, for anyone not sitting down
      if (pose.kind !== 'sit' && pose.kind !== 'slump') {
        const lift = pose.kind === 'walk' ? (pose.step === 0 ? [1, 0] : [0, 1]) : pose.kind === 'tap' ? [0, pose.beat] : [0, 0];
        fill(x - 3, top + 17, 7, 1, SHADOW);
        fill(x - 3, top + 13, 7, 1, outfit.pants);
        fill(x - 2, top + 14 - lift[0], 2, 2, outfit.pants);
        fill(x + 1, top + 14 - lift[1], 2, 2, outfit.pants);
        fill(x - 2, top + 16 - lift[0], 2, 1, outfit.shoes);
        fill(x + 1, top + 16 - lift[1], 2, 1, outfit.shoes);
      }

      // Shirt and arms
      fill(x - 3, top + 7, 7, 6, shirtColour);
      if (!away) drawOutfitFront(x, top + 7, 3, 6, outfit);
      if (pose.kind === 'wave') {
        sleeve(x - 4, top + 8, 1, 4);
        dot(x - 4, top + 12, look.skin);
        sleeve(x + 4, top + 4, 1, 4);
        dot(x + 4 + pose.frame, top + 3, look.skin);
      } else if (pose.kind === 'cheer') {
        // Both arms up, punching the air
        sleeve(x - 4, top + 4 + pose.frame, 1, 4);
        dot(x - 4, top + 3 + pose.frame, look.skin);
        sleeve(x + 4, top + 5 - pose.frame, 1, 4);
        dot(x + 4, top + 4 - pose.frame, look.skin);
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

      // Fired, they carry their things out in a box.
      if (person.isFired && person.isLeaving) {
        fill(x - 4, top + 8, 9, 5, 0xc49a6c);
        fill(x - 4, top + 8, 9, 1, 0xa07a50);
        fill(x, top + 8, 1, 5, 0xe0c890);
        dot(x - 2, top + 7, PALETTE.leaf);
        dot(x + 2, top + 7, PALETTE.mug);
      }

      // Head: a face, or the back of it, and the hair. A shaved head shows
      // skin where the hair would be, a buzz cut a thin layer of it.
      const shaved = look.hairStyle === 'bald' || look.hairStyle === 'mohawk';
      const cropped = shaved || look.hairStyle === 'buzz';
      fill(x - 3, top + 2, 7, 5, away && !shaved ? look.hair : look.skin);
      if (away) fill(x - 2, top + 6, 5, 1, look.skin);
      if (cropped) {
        fill(x - 2, top + 1, 5, 1, shaved ? look.skin : look.hair);
      } else {
        fill(x - 2, top, 5, 1, look.hair);
        fill(x - 3, top + 1, 7, 1, look.hair);
        dot(x - 3, top + 2, look.hair);
        dot(x + 3, top + 2, look.hair);
      }
      if (look.hairStyle === 'long') {
        fill(x - 3, top + 2, 1, 7, look.hair);
        fill(x + 3, top + 2, 1, 7, look.hair);
      } else if (look.hairStyle === 'spiky') {
        for (const dx of [-2, 0, 2]) dot(x + dx, top - 1, look.hair);
      } else if (look.hairStyle === 'bun') {
        fill(x - 1, top - 2, 3, 2, look.hair);
      } else if (look.hairStyle === 'curly') {
        for (const dx of [-3, -1, 1, 3]) dot(x + dx, top - 1, look.hair);
        dot(x - 4, top + 2, look.hair);
        dot(x + 4, top + 2, look.hair);
      } else if (look.hairStyle === 'ponytail') {
        fill(x + 4, top + 1, 1, 5, look.hair);
      } else if (look.hairStyle === 'afro') {
        fill(x - 4, top - 2, 9, 3, look.hair);
        fill(x - 4, top + 1, 1, 4, look.hair);
        fill(x + 4, top + 1, 1, 4, look.hair);
      } else if (look.hairStyle === 'mohawk') {
        fill(x, top - 2, 1, 3, look.hair);
      }
      drawHeadwear(x, top, look.extra, outfit.shirt, away);

      if (away) return;
      drawFace(x, top, look);
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
      // Sunglasses stay on, whatever the eyes behind them do.
      if (look.extra === 'sunglasses') fill(x - 3, top + 4, 7, 1, SHADES);
    }

    /** What's worn on the head, seen from in front or behind: headphones, a cap, a beanie or a bow. */
    function drawHeadwear(x, top, extra, colour, away) {
      if (extra === 'headphones') {
        fill(x - 3, top - 1, 7, 1, HEADPHONES);
        fill(x - 4, top, 1, 2, HEADPHONES);
        fill(x + 4, top, 1, 2, HEADPHONES);
        fill(x - 4, top + 2, 1, 3, HEADPHONES);
        fill(x + 4, top + 2, 1, 3, HEADPHONES);
      } else if (extra === 'cap') {
        fill(x - 3, top - 1, 7, 2, colour);
        if (!away) fill(x - 4, top + 1, 9, 1, darker(colour));
      } else if (extra === 'beanie') {
        fill(x - 3, top - 1, 7, 2, colour);
        fill(x - 3, top + 1, 7, 1, darker(colour));
        dot(x, top - 2, PALETTE.paper);
      } else if (extra === 'bow') {
        dot(x + 1, top - 1, BOW);
        dot(x + 3, top - 1, BOW);
        dot(x + 2, top - 1, darker(BOW));
      }
    }

    /** What's on the face, under the eyes drawn over it: glasses, a beard or a moustache. */
    function drawFace(x, top, look) {
      if (look.extra === 'glasses') {
        fill(x - 3, top + 3, 3, 1, PALETTE.eye);
        fill(x + 1, top + 3, 3, 1, PALETTE.eye);
        for (const dx of [-3, -1, 1, 3]) dot(x + dx, top + 4, GLASS);
      } else if (look.extra === 'beard') {
        fill(x - 3, top + 4, 1, 3, look.hair);
        fill(x + 3, top + 4, 1, 3, look.hair);
        fill(x - 2, top + 6, 5, 1, look.hair);
      } else if (look.extra === 'moustache') {
        fill(x - 1, top + 5, 3, 1, look.hair);
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
      const button = placed('button', BUTTON);
      for (const delay of [0, 0.15]) {
        const age = (since - delay) / SHOCKWAVE_LENGTH;
        if (age < 0 || age >= 1) continue;
        const radius = 3 + age * 150;
        const count = Math.floor(radius * 4);
        for (let k = 0; k < count; k++) {
          const angle = (k / count) * 2 * Math.PI;
          dot(Math.round(button.x + Math.cos(angle) * radius), Math.round(button.y + Math.sin(angle) * radius * 0.55),
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
      // The screen's top-left, wherever the desk has it
      const { screen } = WORKSPACES[workspaceOf(session)];
      const x = DESKS[desk].x + screen.dx, y = DESKS[desk].y + screen.dy;
      const blinkedOff = session.state === 'asking' && Math.floor(now * 2) % 2 === 1;
      // A command running turns the screen terminal-green.
      const shell = session.state === 'thinking' && toolKind(session.tool) === 'shell';
      const light = shell ? PALETTE.terminal
        : session.state === 'idle' || blinkedOff ? PALETTE.monitorOn : colour(session.state);

      if (session.state !== 'idle') fill(x - 3, y - 3, 19, 14, light, 0.12);
      fill(x - 1, y - 1, 15, 1, light);
      fill(x - 1, y, 1, 9, light);
      fill(x + 13, y, 1, 9, light);

      if (shell) {
        // Lines of output, scrolling up
        for (let k = 0; k < 4; k++) {
          const rise = (now * 1.4 + k / 4) % 1;
          fill(x + 1 + (k % 2) * 2, y - 2 - Math.round(rise * 9), 5 + (k % 3) * 2, 1, light, 1 - rise);
        }
      } else if (session.state === 'thinking') {
        for (let k = 0; k < 3; k++) {
          const rise = (now * 0.8 + k / 3 + desk * 0.17) % 1;
          dot(x + 2 + k * 4, y - 2 - Math.round(rise * 9), light, 1 - rise);
        }
      } else if (session.state === 'error') {
        for (let k = 0; k < 3; k++) {
          const rise = (now * 0.5 + k / 3) % 1;
          const size = rise > 0.5 ? 3 : 2;
          const drift = Math.round(Math.sin(rise * 6 + k) * 1.5);
          fill(x + 3 + k * 2 + drift, y - 3 - Math.round(rise * 12), size, size, PALETTE.smoke, 0.8 * (1 - rise));
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
      const top = topOf(person, pose);
      let x = Math.round(person.position.x);

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
        // A nap, after a while on the couch or the beanbag, not at the drums or in the hot tub
        const spot = spotOf(person.place);
        if (person.isWalking || spot === null || spots[spot].pose !== 'sit' || now - person.arrivedAt <= 20) return;
        if (spot >= LOUNGE_SPOTS.length && decor.corner !== 'books') return;
        const rise = (now * 0.35 + person.look.phase) % 1;
        const zx = x + 3 + Math.round(rise * 3), zy = top - 3 - Math.round(rise * 8);
        fill(zx, zy, 3, 1, WHITE, 1 - rise);
        dot(zx + 1, zy + 1, WHITE, 1 - rise);
        fill(zx, zy + 2, 3, 1, WHITE, 1 - rise);
        return;
      }

      // Kept waiting, the bubble shakes and turns red, and steam rises.
      const agitation = state === 'asking' ? agitationOf(person, now) : 0;
      const bob = state === 'asking' && Math.floor(now * (3 + 6 * agitation)) % 2 === 0 ? -1 : 0;
      const bottom = top - 3 + bob;
      if (agitation) {
        for (const side of [-1, 1]) {
          const rise = (now * 1.4 + (side > 0 ? 0.5 : 0)) % 1;
          fill(x + side * 5, top + 2 - Math.round(rise * 6), 2, 1, PALETTE.smoke, agitation * (1 - rise));
        }
        x += Math.floor(now * 14) % 2 ? 1 : -1;
      }
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
      for (const [column, row] of cells) dot(x + column, bottom - 5 + row, agitation ? PALETTE.alarm : colour(state));
    }

    /** Confetti over whoever just finished a turn of an hour or more, falling and fading. */
    function drawConfetti(person) {
      const since = person.celebratedAt === null ? Infinity : now - person.celebratedAt;
      if (since >= PARTY_LENGTH || person.isLeaving) return;
      const x = person.position.x, top = topOf(person, poseOf(person, now));
      const colours = [0xf2d35b, 0xd96a5a, 0x4c8bf5, 0x4f9a5a, 0xf28fb0, 0x86d6bc];
      for (let i = 0; i < 28; i++) {
        // The same scatter every time, from the person's own look
        const r = (k) => ((Math.sin((i + 1) * 12.9898 + k * 78.233 + person.look.phase * 43.1) * 43758.5453) % 1 + 1) % 1;
        const vx = (r(1) - 0.5) * 50, vy = -35 - r(2) * 25, t = since + r(3) * 0.15;
        const px = x + vx * t, py = top - 2 + vy * t + 45 * t * t;
        const flutter = Math.floor((now * 8 + i) % 2);
        fill(px, py, 1 + flutter, 2 - flutter, colours[i % colours.length], Math.min(1, (PARTY_LENGTH - since) / 0.8));
      }
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
      // A nickname you've given their agent, or their project's name.
      const member = memberOf(s.session);
      const name = s.session ? (member && member.name) || s.session.name : s.pin;
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
     * The front of an outfit, over a shirt `half` either side of `x` and
     * `rows` tall from `y`: a T-shirt's stripe, a shirt's collar and buttons,
     * the shirt under a jacket, or a suit's tie.
     */
    function drawOutfitFront(x, y, half, rows, outfit) {
      const white = PALETTE.paper;
      if (outfit.style === 'tee') {
        fill(x - half, y + 2, half * 2 + 1, 1, white);
      } else if (outfit.style === 'hoodie') {
        // The hood round the neck, its strings, and the pocket
        dot(x - 2, y, darker(outfit.shirt));
        dot(x + 2, y, darker(outfit.shirt));
        dot(x - 1, y + 2, white);
        dot(x + 1, y + 2, white);
        fill(x - half + 1, y + rows - 2, half * 2 - 1, 1, darker(outfit.shirt));
      } else if (outfit.style === 'sweater') {
        // A knitted band across the chest, and the ribbing at the hem
        fill(x - half, y + 2, half * 2 + 1, 1, lighter(outfit.shirt));
        fill(x - half, y + rows - 1, half * 2 + 1, 1, darker(outfit.shirt));
      } else if (outfit.style === 'labcoat') {
        // Open over a blue shirt, a pen in the pocket
        fill(x, y, 1, rows - 1, LAB_SHIRT);
        dot(x - 2, y + 2, LAB_PEN);
      } else if (outfit.style === 'collar') {
        dot(x - 2, y, white);
        dot(x + 2, y, white);
        for (let row = 2; row < rows; row += 2) dot(x, y + row, darker(outfit.shirt));
      } else if (outfit.style === 'jacket') {
        fill(x, y, 1, rows - 2, white);
      } else if (outfit.style === 'suit') {
        dot(x - 1, y, white);
        dot(x + 1, y, white);
        fill(x, y, 1, rows - 2, outfit.tie);
      } else if (outfit.style === 'polo') {
        // A soft collar, and a short placket with a button
        dot(x - 1, y, lighter(outfit.shirt));
        dot(x + 1, y, lighter(outfit.shirt));
        dot(x, y + 1, darker(outfit.shirt));
        dot(x, y + 2, white);
      } else if (outfit.style === 'cardigan') {
        // Open over a white shirt, buttoned down one side
        fill(x, y, 1, rows - 1, white);
        for (let row = 2; row < rows; row += 2) dot(x - 1, y + row, darker(outfit.shirt));
      } else if (outfit.style === 'hawaiian') {
        // An open collar, and flowers
        dot(x - 1, y, white);
        dot(x + 1, y, white);
        for (const [dx, dy, flower] of [[-half, 1, white], [half - 1, 2, HIBISCUS], [1 - half, 3, HIBISCUS], [half, 4, white]]) {
          if (dy < rows) dot(x + dx, y + dy, flower);
        }
      } else if (outfit.style === 'tracksuit') {
        // A zip down the middle, and a stripe on each shoulder
        fill(x, y, 1, rows - 1, lighter(outfit.shirt));
        dot(x - half, y, white);
        dot(x + half, y, white);
      } else if (outfit.style === 'overalls') {
        // The bib over the shirt, its straps and their buttons
        fill(x - half + 1, y + 2, half * 2 - 1, rows - 2, DENIM);
        for (const side of [-1, 1]) {
          fill(x + side * (half - 1), y, 1, 2, DENIM);
          dot(x + side * (half - 1), y + 2, HIBISCUS);
        }
      } else if (outfit.style === 'waistcoat') {
        // The white shirt showing at the neck, and buttons down the front
        fill(x - 1, y, 3, 1, outfit.sleeves);
        dot(x, y + 1, outfit.sleeves);
        for (let row = 2; row < rows; row += 2) dot(x, y + row, darker(outfit.shirt));
      }
    }

    /**
     * A subagent, as an intern: 13 art pixels tall, dressed as their agent's
     * agents are or for their own model, with a badge.
     */
    function drawIntern(intern) {
      const x = Math.round(intern.position.x), feet = Math.round(intern.position.y), top = feet - 13;
      const { look } = intern, outfit = outfitOf(intern.agent, intern.model), shirt = outfit.shirt;
      const step = intern.isWalking ? Math.floor(now * 7) % 2 : null;
      const lift = step === null ? [0, 0] : step === 0 ? [1, 0] : [0, 1];
      fill(x - 2, feet, 5, 1, SHADOW);
      fill(x - 2, top + 9, 5, 1, outfit.pants);
      fill(x - 1, top + 10 - lift[0], 1, 2, outfit.pants);
      fill(x + 1, top + 10 - lift[1], 1, 2, outfit.pants);
      dot(x - 1, top + 12 - lift[0], outfit.shoes);
      dot(x + 1, top + 12 - lift[1], outfit.shoes);
      fill(x - 2, top + 5, 5, 4, shirt);
      drawOutfitFront(x, top + 5, 2, 4, outfit);
      // The badge goes beside buttons, a jacket's opening or a tie.
      if (outfit.style === 'plain' || outfit.style === 'tee') dot(x, top + 6, PALETTE.bubble);
      else dot(x + 1, top + 7, PALETTE.bubble);
      ctx.fillStyle = css(outfit.sleeves ?? shirt, 1, 0.78);
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
      // The screen is eleven pixels across, inside its edge: the colon goes
      // without the gaps round it, so m:ss fits inside it.
      const gap = (c, next) => (c === ':' || next === ':' ? 0 : 1);
      const chars = [...text];
      const width = chars.reduce((w, c, i) => w + GLYPHS[c][0].length + (i < chars.length - 1 ? gap(c, chars[i + 1]) : 0), 0);
      const { screen } = WORKSPACES[workspaceOf(session)];
      let at = x + screen.dx + 1 + Math.floor((11 - width) / 2);
      chars.forEach((c, i) => {
        GLYPHS[c].forEach((row, r) => [...row].forEach((on, column) => { if (on === '1') dot(at + column, y + screen.dy + 2 + r, PALETTE.bubble); }));
        at += GLYPHS[c][0].length + gap(c, chars[i + 1]);
      });

      const occupant = occupantOf(desk);
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
      const { x, y } = DESKS[selectedDesk], top = y + reachOf(selectedDesk);
      for (const [grow, alpha] of [[0, 0.1], [3, 0.06]]) {
        fill(x - 4 - grow, top + grow / 2, DESK_WIDTH + 8 + grow * 2, y + 20 - top - grow, ink, alpha);
      }
    }

    function drawSelectionCorners() {
      if (selectedDesk < 0) return;
      const { x, y } = DESKS[selectedDesk];
      const left = x - 3, right = x + DESK_WIDTH + 2, top = y + reachOf(selectedDesk), bottom = y + 18;
      for (const [cx, cy, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]]) {
        fill(dx > 0 ? cx : cx - 3, cy, 4, 1, ink);
        fill(cx, dy > 0 ? cy : cy - 3, 1, 4, ink);
      }
    }

    /**
     * An agent carried to another desk: lifted to just above the finger,
     * legs dangling, their chair held over their head, and the desk they'd
     * land at marked as the picked desk is.
     */
    function drawCarried({ person, x, y, over, from }) {
      if (over !== null && over !== from) {
        const d = DESKS[over];
        const left = d.x - 3, right = d.x + DESK_WIDTH + 2, top = d.y + reachOf(over), bottom = d.y + 18;
        const blink = 0.55 + 0.45 * Math.sin(now * 8);
        for (const [cx, cy, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]]) {
          fill(dx > 0 ? cx : cx - 3, cy, 4, 1, ink, blink);
          fill(cx, dy > 0 ? cy : cy - 3, 1, 4, ink, blink);
        }
      }
      if (!person) return;
      // Feet a little above the finger, so the finger doesn't hide them
      const lifted = Object.create(person, {
        position: { value: { x: Math.round(x), y: Math.round(y) - 6 } },
        path: { value: [null] }, // walking in the air
        place: { value: 'carried' },
      });
      drawPerson(lifted);
      const top = topOf(lifted, poseOf(lifted, now));
      // Their chair, or what they sit on at a workspace with none
      const workspace = WORKSPACES[workspaceOf(person.session)];
      const [chair, chairTop] = workspace.carry || CHAIRS[decor.chair];
      fill(lifted.position.x - 4, top - 5, 9, 2, chairTop);
      fill(lifted.position.x - 3, top - 3, 1, 2, chair);
      fill(lifted.position.x + 3, top - 3, 1, 2, chair);
    }

    /** Sound waves from the mic while it's held, spreading across the room. */
    function drawMicWaves() {
      if (!mic.held) return;
      const heldFor = now - mic.heldAt;
      const at = placed('mic', MIC);
      const mouth = decor.mic === 'megaphone' ? { x: at.x - 8, y: at.y - 20 } : { x: at.x, y: at.y - 21 };
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

    /** A pixel key: a face over a darker edge, with its label in the pixel font. */
    function drawPixelKey(x, y, w, h, face, label) {
      fill(x + 1, y, w - 2, h, PALETTE.frame);
      fill(x, y + 1, w, h - 2, PALETTE.frame);
      fill(x + 1, y + 1, w - 2, h - 2, darker(face));
      fill(x + 1, y + 1, w - 2, h - 4, face);
      fill(x + 2, y + 1, w - 4, 1, WHITE, 0.3);
      pixelText(label, x + Math.round((w - textWidth(label)) / 2), y + Math.floor((h - 4 - 5) / 2) + 1, WHITE, false);
    }

    /** YOU'RE FIRED in red, or HIRE in green, on a held desk. */
    function drawDeskButton({ kind, label, left, top, w, h }) {
      drawPixelKey(left, top, w, h, kind === 'fire' ? PALETTE.dome : 0x2f8f5b, label);
    }

    /** The question before firing, over a dimmed room. */
    function drawFireDialog({ left, top, w, h, keys, name }) {
      fill(seen.left, seen.top, seen.width, seen.height, BLACK, 0.45);
      fill(left + 1, top, w - 2, h, PALETTE.bubbleEdge);
      fill(left, top + 1, w, h - 2, PALETTE.bubbleEdge);
      fill(left + 1, top + 1, w - 2, h - 2, PALETTE.bubble);
      const size = Math.max(LABEL_SIZE * scale, LABEL_SMALLEST * ratio);
      const font = (weight, px) => `${weight} ${px}px ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif`;
      const middle = screen(left + w / 2, 0).x;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = css(PALETTE.bubbleEdge);
      ctx.font = font(700, size * 1.25);
      ctx.fillText(fitText(ctx, `Fire ${name}?`, (w - 12) * scale), middle, screen(0, top + 11).y);
      ctx.font = font(500, size);
      ctx.fillStyle = css(PALETTE.bubbleEdge, 0.7);
      ctx.fillText(fitText(ctx, 'Its agent stops, and its tab closes.', (w - 12) * scale), middle, screen(0, top + 21).y);
      for (const key of keys) drawPixelKey(key.x, key.y, key.w, key.h, key.action === 'fired' ? PALETTE.dome : PALETTE.rail, key.label);
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
    /** A part of the lounge, at the depth it stands at in the wide room, where the room's shape puts it. */
    const lounge = (part, depth, draw) => [placed(part, { x: 0, y: depth }).y, () => moved(part, draw)];
    const items = [
      lounge('wall', 46.5, drawCounter), lounge('wall', 50, drawCooler), lounge('couch', 110, drawCouchBack),
      lounge('couch', 117, drawCouchFront), lounge('couch', 134, drawCoffeeTable), lounge('pong', 157, drawPingPong),
      lounge('plant', 176, drawPlant), lounge('button', 176.5, drawButton), lounge('mic', 177, drawMic),
      ...CORNER_PARTS[decor.corner].map(([depth, draw]) => lounge('corner', depth, draw)),
    ];
    if (shape.loungeWall !== undefined) items.push([shape.loungeWall, drawLoungeWall]);
    const pet = office.pet;
    if (pet) items.push([!pet.isWalking && pet.target && pet.target.depth ? pet.target.depth : pet.position.y, drawPet]);
    DESKS.forEach((d, desk) => {
      items.push([d.y + 5, () => drawDesk(desk)]);
      items.push([d.y + 3.5, () => drawChair(desk)]); // just behind whoever sits in it
      items.push([d.y + 3, () => drawWorkspaceBack(desk)]);
    });
    // Someone being carried is drawn on top, where the finger has them, not at their desk. Someone at
    // the clock or the whiteboard is in front of the first row's workspaces, the tallest of which reach
    // the wall: they're there to be seen.
    const atWall = (person) => !person.isWalking && /^(clock|board):/.test(person.place);
    for (const person of office.people) {
      if (person !== carried) items.push([atWall(person) ? DESKS[0].y + 5.5 : person.position.y, () => drawPerson(person)]);
    }
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
    if (frame.carrying) drawCarried(frame.carrying);
    office.people.forEach(drawBubble);
    office.people.forEach(drawConfetti);
    DESKS.forEach((_, desk) => drawLabel(desk));
    if (frame.chips) drawChips();
    if (frame.deskButton) drawDeskButton(frame.deskButton);
    if (frame.choices) drawChoices();
    if (frame.firing) drawFireDialog(frame.firing);

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

  function roundedRect(ctx, x, y, w, h, radius) {
    // Square corners, as the screen saver has, can bring an inner ring's
    // radius below nothing, which the canvas refuses outright.
    const r = Math.max(0, radius);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* -------------------------------------------------------------- sound */

  /** How loud the office is, as set up: its master volume. */
  const SOUND_LEVELS = { off: 0, quiet: 0.4, normal: 1 };
  /**
   * The loudest the room gets: the reminder's level, at 0 dB. Everything
   * else is set below it, in dB, so the one sound that asks for you stands
   * out and the rest stays in the background.
   */
  const REFERENCE = 0.15;
  const dB = (level) => REFERENCE * 10 ** (level / 20);
  /** A console's frame: envelopes and pitch sweeps step at this rate, which is most of what makes them sound 8-bit. */
  const FRAME = 1 / 60;

  /** A note by name, natural notes only, C4 being middle C. Every tune keeps to C major pentatonic, so nothing that overlaps can clash. */
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const hz = (name) => 440 * 2 ** ((NOTE[name[0]] + 12 * (Number(name.slice(1)) + 1) - 69) / 12);

  /** Where across the room a sound comes from, as a pan: kept towards the middle, so headphones don't feel lopsided. */
  const panAt = (x) => Math.max(-1, Math.min(1, (x / WIDTH) * 2 - 1)) * 0.6;

  /**
   * The channels of an old console: pulse waves of three widths, a triangle
   * in 16 steps, as the NES plays it, and noise from a shift register, kept
   * for what should crunch. Each is made once for a context.
   */
  const waveCache = new WeakMap();
  function chipWaves(audio) {
    if (waveCache.has(audio)) return waveCache.get(audio);
    const HARMONICS = 40;
    // A wave held at each level of `steps` for an equal share of its cycle, as its harmonics.
    const stepped = (steps) => {
      const real = new Float32Array(HARMONICS + 1), imag = new Float32Array(HARMONICS + 1);
      for (let n = 1; n <= HARMONICS; n++) {
        steps.forEach((level, k) => {
          const a = (2 * Math.PI * n * k) / steps.length, b = (2 * Math.PI * n * (k + 1)) / steps.length;
          real[n] += (level * (Math.sin(b) - Math.sin(a))) / (Math.PI * n);
          imag[n] += (level * (Math.cos(a) - Math.cos(b))) / (Math.PI * n);
        });
      }
      return audio.createPeriodicWave(real, imag);
    };
    const pulse = (eighths) => stepped(Array.from({ length: 8 }, (_, k) => (k < eighths ? 1 : -1)));
    const triangle = stepped(Array.from({ length: 32 }, (_, k) => (k < 16 ? k : 31 - k) / 7.5 - 1));
    // Each step of the register is held for two samples; a sound pitches it with its playback rate.
    const noise = (length) => {
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0, register = 1; i < length; i += 2) {
        const bit = (register ^ (register >> 1)) & 1;
        register = (register >> 1) | (bit << 14);
        data.fill(register & 1 ? -1 : 1, i, i + 2);
      }
      return buffer;
    };
    const waves = {
      pulse12: pulse(1), pulse25: pulse(2), pulse50: pulse(4), triangle,
      hiss: noise(audio.sampleRate),
    };
    waveCache.set(audio, waves);
    return waves;
  }

  /** Plays chip notes into one output: everything the office and the deck say is made of these two. */
  class Chip {
    constructor(audio, out) {
      this.audio = audio;
      this.out = out;
      this.waves = chipWaves(audio);
    }

    /** Into the output, panned from -1, the left, to 1, the right. */
    route(node, pan) {
      if (!pan || !this.audio.createStereoPanner) return node.connect(this.out);
      const panner = this.audio.createStereoPanner();
      panner.pan.value = pan;
      node.connect(panner).connect(this.out);
    }

    /**
     * The volume stepping down a frame at a time, in 15 steps, from `level`
     * to nothing over `length`; the higher the `curve`, the quicker it drops.
     * Each step eases in over a few milliseconds, which keeps it from clicking
     * or buzzing.
     */
    envelope(at, length, level, curve) {
      const gain = this.audio.createGain();
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, at);
      const frames = Math.max(1, Math.round(length / FRAME));
      for (let k = 0; k < frames; k++) {
        gain.gain.setTargetAtTime((level * Math.ceil(15 * (1 - k / frames) ** curve)) / 15, at + k * FRAME, k ? 0.005 : 0.002);
      }
      gain.gain.setTargetAtTime(0, at + length, 0.004);
      return gain;
    }

    /** A pitch stepped a frame at a time from `from` to `to`, with a wobble of `vibrato`, a share of the pitch. */
    sweep(param, at, length, from, to, vibrato) {
      const frames = Math.max(1, Math.round(length / FRAME));
      for (let k = 0; k <= frames; k++) {
        const wobble = vibrato ? 1 + vibrato * Math.sin(k * FRAME * 2 * Math.PI * 6) : 1;
        param.setValueAtTime(from * (to / from) ** (k / frames) * wobble, at + k * FRAME);
      }
    }

    /** A note on a pulse or the triangle. */
    note(at, { wave = 'pulse25', pitch, to = pitch, length, level, pan = 0, curve = 1.5, vibrato = 0 }) {
      const osc = this.audio.createOscillator();
      osc.setPeriodicWave(this.waves[wave]);
      this.sweep(osc.frequency, at, length, pitch, to, vibrato);
      this.route(osc.connect(this.envelope(at, length, level, curve)), pan);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }

    /** A burst of noise, its `rate` a playback rate from 1, the brightest, down. */
    noise(at, { rate = 1, to = rate, length, level, pan = 0, curve = 1.5, lowpass = 0 }) {
      const source = this.audio.createBufferSource();
      source.buffer = this.waves.hiss;
      source.loop = true;
      this.sweep(source.playbackRate, at, length, rate, to, 0);
      let node = source;
      if (lowpass) {
        const filter = this.audio.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = lowpass;
        node = node.connect(filter);
      }
      this.route(node.connect(this.envelope(at, length, level, curve)), pan);
      source.start(at, Math.random() * source.buffer.duration * 0.9);
      source.stop(at + length + 0.05);
    }
  }

  /** The deck's one reminder: two bright notes and their echo, the only sound that asks for you. */
  function remindSound(chip, at, pan = 0) {
    [['A5', 0], ['E6', 0.14]].forEach(([name, after]) => {
      for (const [late, level] of [[0, 0], [0.13, -12]]) {
        chip.note(at + after + late, { wave: 'pulse25', pitch: hz(name), length: 0.42, level: dB(level), pan, curve: 1.2 });
        chip.note(at + after + late, { wave: 'triangle', pitch: hz(name) / 2, length: 0.3, level: dB(level - 9), pan });
      }
    });
  }

  /**
   * Every sound the office knows, by name, with how soon it may play again,
   * in seconds, and how loud it is, in dB below the reminder. Anything in the
   * room can ask for one with `office.cue(name, x)`; a name with nothing
   * here yet is let go quietly.
   */
  const SOUNDS = {
    // A long turn done: a fanfare on a pulse over a triangle bass, -10.
    fanfare: {
      gap: 2,
      play(chip, at, pan) {
        const lead = [['E5', 0.09], ['G5', 0.09], ['C6', 0.09], ['E6', 0.09], ['D6', 0.12], ['E6', 0.12], ['G6', 0.5]];
        let when = at;
        for (const [name, length] of lead) {
          chip.note(when, { wave: 'pulse25', pitch: hz(name), length: length + 0.04, level: dB(-10), pan, curve: 0.6, vibrato: length > 0.3 ? 0.006 : 0 });
          when += length;
        }
        [['C3', 0.36], ['G3', 0.24], ['C4', 0.6]].reduce((t, [name, length]) => {
          chip.note(t, { wave: 'triangle', pitch: hz(name), length, level: dB(-12), pan, curve: 0.5 });
          return t + length;
        }, at);
      },
    },
    // The red button: a chip explosion, then a two-tone siren for as long as the warning light turns, -8.
    blast: {
      gap: 1,
      play(chip, at, pan) {
        chip.noise(at, { rate: 0.5, to: 0.02, length: 1.1, level: dB(-8), pan, curve: 1.2 });
        chip.note(at, { wave: 'triangle', pitch: hz('G2'), to: hz('C1'), length: 0.5, level: dB(-10), pan });
        for (let k = 0; k < 10; k++) {
          chip.note(at + 0.5 + k * 0.34, { wave: 'pulse25', pitch: hz(k % 2 ? 'D5' : 'G5'), length: 0.32, level: dB(-18 - k * 1.4), pan: 0, curve: 0.4 });
        }
      },
    },
    // Someone new at a desk: three notes up, -10.
    hire: {
      gap: 3,
      play(chip, at, pan) {
        ['C5', 'E5', 'G5', 'C6'].forEach((name, k) => {
          chip.note(at + k * 0.07, { wave: 'pulse25', pitch: hz(name), length: k === 3 ? 0.3 : 0.08, level: dB(-10), pan });
        });
      },
    },
    // Someone fired, picking up their box: a sad trombone, falling, -10.
    fire: {
      gap: 3,
      play(chip, at, pan) {
        [['G4', 0.16], ['E4', 0.16], ['D4', 0.16], ['C4', 0.5]].reduce((t, [name, length], k) => {
          const pitch = hz(name);
          chip.note(t, { wave: 'pulse50', pitch, to: k === 3 ? pitch * 0.94 : pitch * 0.98, length, level: dB(-12), pan, curve: 0.7, vibrato: k === 3 ? 0.012 : 0 });
          return t + length + 0.02;
        }, at);
      },
    },
    // The door, as someone comes or goes: the latch's click, then ka-chunk, -14.
    door: {
      gap: 1.2,
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse12', pitch: hz('C6'), length: 0.015, level: dB(-26), pan, curve: 3 });
        chip.note(at + 0.01, { wave: 'triangle', pitch: hz('G3'), to: hz('D3'), length: 0.08, level: dB(-14), pan });
        chip.note(at + 0.14, { wave: 'triangle', pitch: hz('D3'), to: hz('G2'), length: 0.1, level: dB(-15), pan });
      },
    },
    // The ball off a paddle, -18, and off the table between, -26.
    paddle: {
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse12', pitch: pan < 0 ? hz('D6') : hz('C6'), to: hz('G5'), length: 0.05, level: dB(-18), pan, curve: 2 });
        chip.noise(at, { rate: 0.7, length: 0.02, level: dB(-24), pan, curve: 2 });
      },
    },
    table: {
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse12', pitch: hz('G6'), to: hz('E6'), length: 0.03, level: dB(-26), pan, curve: 2 });
      },
    },
    // The coffee machine: bubbles rising, then a drip, -18.
    coffee: {
      gap: 4,
      play(chip, at, pan) {
        for (let k = 0; k < 6; k++) {
          const pitch = hz(pick(['C4', 'D4', 'E4', 'G4']));
          chip.note(at + 0.25 + k * random(0.1, 0.15), { wave: 'triangle', pitch, to: pitch * 1.9, length: 0.06, level: dB(-18), pan });
        }
        chip.note(at + 1.2, { wave: 'pulse12', pitch: hz('G6'), to: hz('C6'), length: 0.05, level: dB(-22), pan, curve: 2 });
      },
    },
    // An agent getting to work: a second of a mechanical keyboard, each key
    // a switch's click and the key bottoming out, the space bar lower, -18.
    typing: {
      gap: 1.5,
      play(chip, at, pan) {
        const count = Math.floor(random(13, 17));
        for (let k = 0, when = at; k < count; k++) {
          const space = k === count - 1 || (k > 2 && Math.random() < 0.12);
          const thock = space ? hz('E3') : hz('A3') * random(0.94, 1.12);
          chip.note(when, { wave: 'pulse12', pitch: random(2200, 2900), length: 0.01, level: dB(-26), pan, curve: 3 });
          chip.note(when + 0.004, { wave: 'triangle', pitch: thock * 2, to: thock, length: space ? 0.05 : 0.03, level: dB(space ? -18 : -20), pan, curve: 2 });
          when += random(0.055, 0.12) * (Math.random() < 0.12 ? 2.2 : 1); // now and then, a pause for thought
        }
      },
    },
    // Picking an agent up off their desk, and putting them down at another, -16.
    'pick-up': {
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse25', pitch: hz('G4'), to: hz('G5'), length: 0.08, level: dB(-16), pan });
      },
    },
    'put-down': {
      play(chip, at, pan) {
        chip.note(at, { wave: 'triangle', pitch: hz('E4'), to: hz('E3'), length: 0.1, level: dB(-14), pan });
      },
    },
    // The mic switched on and off: a blip up and a blip down, -18.
    'mic-on': {
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse12', pitch: hz('C6'), length: 0.03, level: dB(-18), pan });
        chip.note(at + 0.04, { wave: 'pulse12', pitch: hz('G6'), length: 0.04, level: dB(-18), pan });
      },
    },
    'mic-off': {
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse12', pitch: hz('G6'), length: 0.03, level: dB(-20), pan });
        chip.note(at + 0.04, { wave: 'pulse12', pitch: hz('C6'), length: 0.04, level: dB(-20), pan });
      },
    },
    // The megaphone's on: its blips, and a little squeal of feedback, -24.
    megaphone: {
      play(chip, at, pan) {
        SOUNDS['mic-on'].play(chip, at, pan);
        chip.note(at + 0.08, { wave: 'pulse50', pitch: hz('E7'), to: hz('G7'), length: 0.16, level: dB(-28), pan, curve: 0.8, vibrato: 0.02 });
      },
    },
    // The pets, now and then as they settle somewhere, -18; the lizard barely, -26.
    cat: {
      gap: 40,
      play(chip, at, pan) {
        chip.note(at, { wave: 'pulse12', pitch: hz('G5'), to: hz('C6'), length: 0.1, level: dB(-18), pan, curve: 0.3 });
        chip.note(at + 0.1, { wave: 'pulse12', pitch: hz('C6'), to: hz('F5'), length: 0.2, level: dB(-18), pan, vibrato: 0.01 });
      },
    },
    dog: {
      gap: 40,
      play(chip, at, pan) {
        for (const after of [0, 0.15]) chip.note(at + after, { wave: 'pulse25', pitch: hz('A5'), to: hz('E5'), length: 0.07, level: dB(-18), pan });
      },
    },
    lizard: {
      gap: 60,
      play(chip, at, pan) {
        for (const after of [0, 0.06]) chip.note(at + after, { wave: 'pulse12', pitch: hz('C7'), length: 0.015, level: dB(-26), pan, curve: 3 });
      },
    },
    monkey: {
      gap: 40,
      play(chip, at, pan) {
        [['E4', 'A4'], ['E4', 'A4'], ['G4', 'D5']].forEach(([from, to], k) => {
          chip.note(at + k * 0.11, { wave: 'triangle', pitch: hz(from), to: hz(to), length: 0.09, level: dB(-18), pan });
        });
      },
    },
    // The seasons in the windows, now and then: the wind whistling in winter, -30, a bird in spring and summer, -26.
    wind: {
      play(chip, at) {
        chip.note(at, { wave: 'triangle', pitch: hz('D5'), to: hz('A5'), length: 1.2, level: dB(-30), curve: 0.3, vibrato: 0.01 });
        chip.note(at + 1.2, { wave: 'triangle', pitch: hz('A5'), to: hz('E5'), length: 1.4, level: dB(-30), curve: 1, vibrato: 0.01 });
      },
    },
    bird: {
      play(chip, at) {
        const pan = random(-0.4, 0.4);
        for (let k = 0; k < (Math.random() < 0.5 ? 2 : 3); k++) {
          chip.note(at + k * 0.12, { wave: 'pulse12', pitch: hz('E7'), to: hz('G7'), length: 0.05, level: dB(-26), pan });
        }
      },
    },
    // The corner piece, while someone's at it.
    arcade: {
      play(chip, at, pan) {
        // A bit of a game, -24: a run of notes, and sometimes a coin's two notes up.
        const scale = ['C6', 'D6', 'E6', 'G6', 'A6'];
        let when = at;
        for (let k = 0; k < Math.floor(random(3, 6)); k++, when += 0.07) chip.note(when, { wave: 'pulse12', pitch: hz(pick(scale)), length: 0.05, level: dB(-24), pan });
        if (Math.random() < 0.3) {
          chip.note(when + 0.1, { wave: 'pulse25', pitch: hz('B5'), length: 0.06, level: dB(-24), pan });
          chip.note(when + 0.16, { wave: 'pulse25', pitch: hz('E6'), length: 0.25, level: dB(-24), pan });
        }
      },
    },
    foosball: {
      play(chip, at, pan) {
        // The ball struck and hitting the side, -20.
        for (const after of Math.random() < 0.5 ? [0] : [0, random(0.2, 0.4)]) {
          chip.note(at + after, { wave: 'pulse12', pitch: hz('E6'), length: 0.012, level: dB(-24), pan, curve: 3 });
          chip.note(at + after, { wave: 'triangle', pitch: hz('A4'), to: hz('E4'), length: 0.05, level: dB(-20), pan });
        }
      },
    },
    fishtank: {
      play(chip, at, pan) {
        // Bubbles, -26.
        for (let k = 0; k < 3; k++) chip.note(at + k * random(0.08, 0.16), { wave: 'triangle', pitch: hz('G4'), to: hz('D5') * random(1, 1.4), length: 0.04, level: dB(-26), pan });
      },
    },
    vending: {
      gap: 4,
      play(chip, at, pan) {
        // A button, the machine working, a can dropping, -18.
        chip.note(at + 0.2, { wave: 'pulse12', pitch: hz('A6'), length: 0.04, level: dB(-22), pan });
        chip.note(at + 0.27, { wave: 'pulse12', pitch: hz('A6'), length: 0.04, level: dB(-22), pan });
        chip.note(at + 0.4, { wave: 'pulse50', pitch: hz('C3'), length: 0.5, level: dB(-28), pan, curve: 0.3, vibrato: 0.03 });
        chip.note(at + 0.95, { wave: 'triangle', pitch: hz('G3'), to: hz('C3'), length: 0.12, level: dB(-18), pan });
      },
    },
    remind: { play: remindSound },
  };

  /** Sounds that are only the room getting on with its day: no more than one of them in this many seconds. */
  const BACKGROUND_GAP = 4;
  /** A rally's hits are heard for its first few: after that, the players carry on in silence. */
  const RALLY_HEARD = 12;
  /** How often the weather in the windows, or the corner piece being played, makes itself heard, in seconds. */
  const WEATHER_EVERY = [50, 120];
  const CORNER_EVERY = [6, 14];
  /** The share of a pet's settlings that it makes a sound for. */
  const PET_CHATTY = 0.35;

  /**
   * The office's sound, in the style of an old console: the door, the coffee
   * machine, the ping-pong ball, an agent getting to work on their keyboard,
   * the pets and the seasons, a fanfare for a long turn done, and the red
   * button's blast and siren, with silence in between. All of it is made on
   * the spot, with nothing to download. Browsers only let a page play sound once
   * it's been tapped, so it wakes with the first tap, and it sleeps while the
   * office is out of sight.
   */
  class Ambience {
    constructor() {
      this.audio = null;      // the sound's own context, once a tap allows it
      this.chip = null;       // what it plays its sounds with
      this.master = null;
      this.since = null;      // when it started following the room, on the room's clock
      this.next = new Map();  // when each sound may next play, on the sound's clock
      this.quietUntil = 0;    // when the next of the room's background sounds may play
      this.nextWeather = null;
      this.nextCorner = null;
      this.rally = { players: null, bounce: null, table: null, hits: 0 };
      this.blast = null;      // the red button's last press, heard
      this.petSettled = null; // when the pet last settled, heard
      this.mic = null;        // when the mic was last held and let go, heard
      this.carried = null;    // where the agent being carried is, as it's heard
      this.heard = new WeakMap(); // what's been played for each person: { arrived, celebrated, fired, out, working }
    }

    /**
     * From a tap: starts the sound, or carries it on. Asleep, or cut off by
     * a call on iOS ('interrupted'), it resumes.
     */
    wake(win, level) {
      if (!level) return;
      if (this.audio) {
        if (this.audio.state !== 'running' && this.audio.state !== 'closed') this.audio.resume().catch(() => {});
        return;
      }
      const Context = win.AudioContext || win.webkitAudioContext;
      if (!Context) return;
      // On iOS, mixed in with whatever else is playing rather than stopping it, and quiet on the silent switch.
      try { if (win.navigator.audioSession) win.navigator.audioSession.type = 'ambient'; } catch {}
      const audio = new Context();
      this.audio = audio;
      // Everything goes through a gentle low-pass, which takes the edge off
      // the pulses, then the volume, then a limiter that only a pile-up reaches.
      const soft = audio.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 7000;
      soft.Q.value = 0;
      this.master = audio.createGain();
      this.master.gain.value = level;
      const limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 3;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      soft.connect(this.master).connect(limiter).connect(audio.destination);
      this.chip = new Chip(audio, soft);
    }

    sleep() {
      if (this.audio && this.audio.state === 'running') this.audio.suspend().catch(() => {});
    }

    /**
     * A sound by name, from `x` across the room, or the middle, `after` so
     * many seconds. It doesn't play when the office is quiet, when there's no
     * such sound, or when it played too recently. Says whether it played.
     */
    play(name, x = null, after = 0) {
      const sound = SOUNDS[name];
      if (!sound || !this.chip || this.audio.state !== 'running') return false;
      const t = this.audio.currentTime;
      if ((this.next.get(name) || 0) > t) return false;
      this.next.set(name, t + (sound.gap || 0));
      sound.play(this.chip, t + 0.02 + after, x === null ? 0 : panAt(x));
      return true;
    }

    /** One of the room's background sounds, if none has played just before it. */
    murmur(name, x) {
      if (this.audio.currentTime < this.quietUntil || !this.play(name, x)) return false;
      this.quietUntil = this.audio.currentTime + BACKGROUND_GAP;
      return true;
    }

    /**
     * Once a frame: the volume as set up, and a sound for whatever has just
     * happened in the room, or been cued by it. `held` is what a finger is
     * doing on it: the mic it holds, and the agent it carries.
     */
    follow(office, now, level, held = {}) {
      const cues = office.cues.splice(0);
      const audio = this.audio;
      if (!audio || audio.state !== 'running') return;
      // Turned off, it sleeps rather than play on at nothing; turned back on, a tap wakes it.
      if (!level) return this.sleep();
      this.master.gain.setTargetAtTime(level, audio.currentTime, 0.2);
      const t = audio.currentTime;
      // Only what happens from now on is heard: everyone already there when it starts is taken as read.
      const settling = this.since === null || now - this.since < 1;
      if (this.since === null) this.since = now;
      for (const cue of cues) this.play(cue.name, cue.x);

      // The ping-pong ball, off each paddle and the table between, for the start of each rally
      const players = PING_PONG.map((spot) => office.people.find((p) => p.place === spotPlace(spot) && !p.isWalking && !p.isLeaving));
      const rally = this.rally;
      if (!players.every(Boolean)) Object.assign(rally, { players: null, bounce: null, table: null, hits: 0 });
      else {
        if (!rally.players || rally.players.some((p, k) => p !== players[k])) Object.assign(rally, { players, hits: 0 });
        // As the room draws it: at the left paddle on each even count, the right on each odd, the table halfway.
        const bounce = Math.floor(now * 0.9), table = Math.floor(now * 1.8);
        if (rally.hits < RALLY_HEARD && rally.bounce !== null) {
          if (bounce !== rally.bounce) {
            this.play('paddle', players[bounce % 2].position.x);
            rally.hits++;
          } else if (table !== rally.table && table % 2) this.play('table', (players[0].position.x + players[1].position.x) / 2);
        }
        Object.assign(rally, { bounce, table });
      }

      // The red button going down
      const blast = office.detonation && office.detonation.at;
      if (blast && blast !== this.blast && !settling) this.play('blast', pointOf('button').x);
      this.blast = blast || this.blast;

      for (const person of office.people) {
        const x = person.position.x;
        let heard = this.heard.get(person);
        if (!heard) {
          heard = { arrived: person.arrivedAt, celebrated: person.celebratedAt, fired: !!person.isFired, out: false, working: person.isAtDesk && person.session.state === 'thinking' };
          this.heard.set(person, heard);
          // Someone new, coming in at the door: an agent hired, or staff
          const atDoor = Math.hypot(x - DOOR.x, person.position.y - DOOR.y) < 14;
          if (!settling && person.isWalking && atDoor) {
            this.play('door', DOOR.x);
            if (!person.isStaff) this.play('hire', x);
          }
          continue;
        }
        // Out through the door
        if (person.isLeaving && !heard.out && Math.hypot(x - DOOR.x, person.position.y - DOOR.y) < 10) {
          heard.out = true;
          this.play('door', DOOR.x);
        }
        // Getting to work, once a turn: a turn waiting on you isn't over yet
        const state = person.session.state;
        if (state === 'idle' || state === 'unread') heard.working = false;
        else if (state === 'thinking' && person.isAtDesk && !heard.working) {
          heard.working = true;
          this.play('typing', x);
        }
        if (person.isFired && !heard.fired) {
          heard.fired = true;
          this.play('fire', x);
        }
        // Arrived somewhere: the coffee machine, or the vending machine
        if (!person.isWalking && heard.arrived !== person.arrivedAt) {
          heard.arrived = person.arrivedAt;
          const spot = spotOf(person.place);
          if (spot === 0) this.play('coffee', x);
          if (decor.corner === 'vending' && spot === LOUNGE_SPOTS.length) this.play('vending', x);
        }
        // A long turn finished
        if (person.celebratedAt !== null && heard.celebrated !== person.celebratedAt) {
          heard.celebrated = person.celebratedAt;
          this.play('fanfare', x);
        }
      }

      // The corner piece, now and then, while someone's at it
      const cornering = office.people.find((p) => !p.isWalking && !p.isLeaving && spotOf(p.place) >= LOUNGE_SPOTS.length);
      if (!cornering || !['arcade', 'foosball', 'fishtank'].includes(decor.corner)) this.nextCorner = null;
      else if (this.nextCorner === null) this.nextCorner = t + random(1, 4);
      else if (t >= this.nextCorner) this.nextCorner = t + (this.murmur(decor.corner, cornering.position.x) ? random(...CORNER_EVERY) : 1);

      // The pet, sometimes, as it settles somewhere new
      const pet = office.pet;
      if (pet && !pet.isWalking && pet.arrivedAt !== this.petSettled) {
        if (this.petSettled !== null && Math.random() < PET_CHATTY) this.murmur(pet.kind, pet.position.x);
        this.petSettled = pet.arrivedAt;
      }

      // The season in the windows, once in a while; autumn's leaves fall without a sound
      const weather = decor.season === 'calendar' ? { winter: 'wind', spring: 'bird', summer: 'bird' }[SEASONS[new Date().getMonth()]] : null;
      if (!weather) this.nextWeather = null;
      else if (this.nextWeather === null) this.nextWeather = t + random(20, 60);
      else if (t >= this.nextWeather) this.nextWeather = t + (this.murmur(weather) ? random(...WEATHER_EVERY) : 2);

      // The mic switched on and off, and an agent picked up and put down
      // A quick tap can hold and let go of the mic between two frames: each is told by its time.
      const { heldAt = null, releasedAt = null } = held.mic || {};
      if (this.mic && heldAt !== this.mic.heldAt && heldAt !== null) this.play(decor.mic === 'megaphone' ? 'megaphone' : 'mic-on');
      if (this.mic && releasedAt !== this.mic.releasedAt && releasedAt !== null) this.play('mic-off', null, 0.12);
      this.mic = { heldAt, releasedAt };
      if (held.carrying && this.carried === null) this.play('pick-up', held.carrying.x);
      if (!held.carrying && this.carried !== null) this.play('put-down', this.carried);
      this.carried = held.carrying ? held.carrying.x : null;
    }
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
  /**
   * How many of the latest snapshots the computer's clock is judged by. Each
   * is a little late, so the smallest gap between the clocks is the truest:
   * a snapshot held up on its way can only make it seem bigger.
   */
  const CLOCK_SAMPLES = 5;
  /** The numbers of keys a layout can fix; anything else is Auto, a key for each agent. */
  const FIXED_KEYS = [3, 6, 9];

  /**
   * The deck's snapshot, as the office reads it: a seat per key, its session
   * if it has one. Turns are timed on this device's clock, `ahead` of the
   * computer's by however much, so a computer set wrong doesn't make every
   * turn look an hour old.
   */
  function seatsOf(snapshot, ahead) {
    return (snapshot.keys || []).map((key) => ({
      pin: key.pin || null,
      session: key.session && {
        ...key.session,
        // Each project always gets the same face, whatever folder its agent is in.
        name: key.session.project || key.session.name || '',
        effort: key.session.effort || '',
        maxPressedAt: key.session.maxPressedAt ?? null,
        turnStartedAt: key.session.turnStartedAt ? key.session.turnStartedAt + ahead : null,
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
    let floating = null;  // floating in a 'window' of its own or a whole 'screen', from 'edge' to edge, or not
    let frame = null;
    let last = 0;
    let selected = null; // the session the deck's controls act on
    let latest = null;   // the deck's last snapshot
    let ahead = 0;       // how far this device's clock is ahead of the computer's, in ms
    let gaps = [];       // how far ahead it seemed as each of the latest snapshots came, in ms
    // The mic: whether a finger holds it, when it last went on and off, and
    // who it talks to.
    const mic = { held: false, heldAt: null, releasedAt: null, listener: null, usable: true };
    let wobbling = null;     // the button or the mic, tapped with no desk picked: { what, at }
    let buttonDown = false;  // a finger on the nuclear button
    let choiceDown = null;   // the last choice key tapped: { action, at, held }
    let chipDown = null;     // the last paint chip tapped: { level, at, held }
    // A desk held down: { kind: 'session', id } for its agent, or { kind: 'empty', desk } for a hire
    let held = null;
    let firing = null;       // an agent about to be fired, while the question is up: { id, name }
    let carrying = null;     // an agent carried to another desk: { person, from, x, y, over }
    let hiring = { fire: false, hire: false }; // what the computer lets a held desk offer
    const ambience = new Ambience();
    const loudness = () => SOUND_LEVELS[decor.sound];
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
        if (win.document.hidden) ambience.sleep();
        else if (visible) ambience.wake(win, loudness()); // seen again: once tapped, it may carry on
        run();
      };
      // Any tap on the page, not only on the room, may start the sound.
      const tapped = () => { if (visible) ambience.wake(win, loudness()); };
      win.document.addEventListener('visibilitychange', seen);
      win.document.addEventListener('pointerdown', tapped, { capture: true });
      host = { window: win, resizing, seen, tapped };
    }

    function unbind() {
      if (!host) return;
      if (frame !== null) host.window.cancelAnimationFrame(frame);
      frame = null;
      host.resizing.disconnect();
      host.window.document.removeEventListener('visibilitychange', host.seen);
      host.window.document.removeEventListener('pointerdown', host.tapped, { capture: true });
      host = null;
    }

    function selectedSession() {
      const seat = office.seats.find((s) => s.session && s.session.id === selected);
      return seat ? seat.session : null;
    }

    /** The paint chips, once held out on the picked desk of an agent with an effort setting, while the dial is out of sight. */
    function chips() {
      if (framed || !held || held.kind !== 'session' || held.id !== selected) return null;
      const desk = office.seats.findIndex((s) => s.session && s.session.id === selected);
      return desk >= 0 && office.seats[desk].session.dial ? effortChips(desk) : null;
    }

    /**
     * Whether a hire on `desk` would sit at it: a pinned desk with nothing
     * running, whose project the new agent starts in, or the one desk an
     * agent hired into no project lands on. That's the first free key's;
     * with none free, Auto adds a key after the last, while there's room
     * for one, and a fixed number of keys has nowhere to put them.
     */
    function hiresInto(desk) {
      if (framed || !hiring.hire) return false;
      const seat = office.seats[desk];
      if (seat && seat.pin) return !seat.session;
      const free = office.seats.findIndex((s) => !s.pin && !s.session);
      if (free >= 0) return desk === free;
      const fixed = FIXED_KEYS.includes(latest && latest.layout && latest.layout.keys);
      return !fixed && desk === office.seats.length && desk < DESKS.length;
    }

    /** The button on a held desk, if the computer allows it: fire its agent, or hire one into it. */
    function heldButton() {
      if (framed || !held) return null;
      if (held.kind === 'empty') return hiresInto(held.desk) ? deskButton(held.desk, 'hire') : null;
      if (held.id !== selected || !hiring.fire) return null;
      const desk = office.seats.findIndex((s) => s.session && s.session.id === held.id);
      return desk >= 0 ? deskButton(desk, 'fire') : null;
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
        office.apply(seatsOf(latest, ahead), latest.theme, time / 1000);
      }
      last = time;
      const now = time / 1000, date = new Date();
      // Dimmed only for a picked session with no voice input: with none
      // picked, a tap wobbles it and asks for a desk.
      const session = selectedSession();
      mic.usable = !session || !!session.mic;
      // A finger held on a desk, or its person, puts out its chips and
      // button; on a desk a hire would sit at, the button to hire.
      const holding = finger && !finger.held && ['session', 'pinned', 'empty'].includes(finger.target.kind);
      if (holding && now - finger.at >= HOLD_FOR_CHIPS) {
        finger.held = true;
        const { kind, id, desk } = finger.target;
        held = kind === 'session' ? { kind, id } : hiresInto(desk) ? { kind: 'empty', desk } : null;
        if (chips() || heldButton()) on.held?.();
      }
      // The room takes its canvas's shape: tall on a screen held upright, where it comes out bigger.
      const fitting = canvas.height > canvas.width ? TALL : WIDE;
      if (fitting !== shape) office.reshape(fitting, now);
      office.step(now);
      ambience.follow(office, now, loudness(), { mic, carrying });
      drawOffice(ctx, office, {
        now, hour: date.getHours(), minute: date.getMinutes(), month: date.getMonth(),
        width: canvas.width, height: canvas.height, ratio: host.window.devicePixelRatio || 1,
        selected, mic, wobble: wobbling, buttonDown, framed, floating, choices: choices(), choiceDown, chips: chips(), chipDown,
        deskButton: heldButton(), firing: firing && { ...fireDialog(), name: firing.name }, carrying,
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
    /** A point on the page, in the room's art pixels, with the scale the room is drawn at. */
    function roomAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const ratio = host.window.devicePixelRatio || 1;
      const { scale, ox, oy } = fitRoom(canvas.width, canvas.height, floating ? FLOAT_MARGINS[floating] * ratio : 0);
      return {
        x: ((clientX - rect.left) * (canvas.width / rect.width) - ox) / scale,
        y: ((clientY - rect.top) * (canvas.height / rect.height) - oy) / scale,
        scale, ratio,
      };
    }

    /**
     * Where a key's desk is, to a finger: its workspace, as high as that
     * reaches, down to the desk's front; and its label below. A tall one
     * reaches up into the label of the desk behind it, where it wins.
     */
    function deskBoxes(desk) {
      const { x, y } = DESKS[desk], seat = office.seats[desk] || {};
      const left = x - 2, right = x + DESK_WIDTH + 2;
      return [
        { left, right, top: y + WORKSPACES[workspaceOf(seat.session)].top, bottom: y + 18 },
        { left, right, top: y + 18, bottom: y + 27 },
      ];
    }

    /** The key's desk under a point of the room, if there is one: where a carried agent would land. */
    function deskAt(x, y) {
      const within = (box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      const boxes = DESKS.slice(0, office.seats.length).map((_, desk) => deskBoxes(desk));
      let desk = boxes.findIndex(([workspace]) => within(workspace));
      if (desk < 0) desk = boxes.findIndex(([, label]) => within(label));
      return desk >= 0 ? desk : null;
    }

    function targetAt(clientX, clientY) {
      const { x, y, scale, ratio } = roomAt(clientX, clientY);
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

      // While the question is up, its keys are all there is; a tap anywhere else keeps them on.
      if (firing) {
        for (const key of fireDialog().keys) consider({ kind: key.action }, { left: key.x, right: key.x + key.w, top: key.y, bottom: key.y + key.h }, -1);
        return best ? best.target : { kind: 'keep' };
      }

      for (const person of office.people) {
        if (person.isStaff || person.isLeaving) continue;
        const px = Math.round(person.position.x), top = topOf(person, poseOf(person, now));
        // The sprite, its arms, and the bubble over its head
        consider({ kind: 'session', id: person.session.id },
          { left: px - 5, right: px + 8, top: top - 11, bottom: Math.round(person.position.y) + 1 }, 0);
      }
      const dome = placed('button', BUTTON), stand = placed('mic', MIC);
      consider({ kind: 'button' }, { left: dome.x - 7, right: dome.x + 8, top: dome.y - 1, bottom: dome.y + 16 }, 1);
      consider({ kind: 'mic' }, { left: stand.x - (decor.mic === 'megaphone' ? 9 : 5), right: stand.x + 6, top: stand.y - 25, bottom: stand.y + 1 }, 1);
      DESKS.forEach((_, desk) => {
        const seat = office.seats[desk] || {};
        // An empty desk only matters where a hire would sit.
        const target = seat.session ? { kind: 'session', id: seat.session.id }
          : seat.pin ? { kind: 'pinned', name: seat.pin, desk }
          : hiresInto(desk) ? { kind: 'empty', desk } : null;
        // The desk, its chair and monitor, and below them its label
        if (!target) return;
        const [workspace, label] = deskBoxes(desk);
        consider(target, workspace, 2);
        consider(target, label, 3);
      });
      const button = heldButton();
      if (button) {
        consider({ kind: button.kind }, { left: button.left, right: button.left + button.w, top: button.top, bottom: button.top + button.h }, -1);
        const onButton = x >= button.left - 1 && x <= button.left + button.w + 1 && y >= button.top - 1 && y <= button.top + button.h + 1;
        if (onButton) return best && best.target.kind === button.kind ? best.target : null;
      }
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
      // Anything else tapped puts the held desk's chips and button away.
      const holding = held;
      if (target.kind !== 'chip') held = null;
      if (target.kind === 'keep') {
        firing = null;
        return;
      }
      // They carry their things out in a box only once the computer says
      // they're fired; if it couldn't, the deck says why.
      if (target.kind === 'fired') {
        const { id } = firing;
        firing = null;
        return Promise.resolve(on.fire?.(id)).then((fired) => {
          const person = office.people.find((p) => !p.isStaff && p.session.id === id);
          if (fired && person) person.isFired = true;
        });
      }
      if (target.kind === 'fire') {
        const seat = office.seats.find((s) => s.session && s.session.id === holding.id);
        // Asked about by the name on their desk: a nickname, or their project's.
        if (seat) firing = { id: holding.id, name: memberOf(seat.session)?.name || seat.session.name };
        return on.held?.();
      }
      if (target.kind === 'hire') return on.hire?.(holding.desk);
      // An empty or pinned desk says something on a tap, once the finger lifts: holding it is something else.
      if (target.kind === 'empty' || target.kind === 'pinned') return;
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

    /**
     * The finger lifts, or is taken away: the mic must always hear about it,
     * or it keeps listening. Lifted over another desk, a carried agent swaps
     * desks with it; taken away, they go back.
     */
    function lift(dropped = false) {
      if (carrying) {
        const { from, over } = carrying;
        carrying = null;
        finger = null;
        if (dropped && over !== null && over !== from) on.swap?.(from, over);
        return;
      }
      // A chip, once chosen, goes away with the rest.
      if (finger && finger.target.kind === 'chip') held = null;
      if (finger && !finger.held) {
        const { kind, name, desk } = finger.target;
        const hold = hiresInto(desk) ? 'Hold the desk to hire someone' : '';
        if (kind === 'pinned') on.hint?.(`Nothing running in ${name}${hold ? `. ${hold}` : ''}`);
        else if (kind === 'empty') on.hint?.(hold);
      }
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
      // A tap on the floor, with nothing there, puts away whatever was held out.
      if (!target) {
        held = null;
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      finger = { id: e.pointerId, target, at: clock(), x: e.clientX, y: e.clientY };
      press(target);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => { if (finger && e.pointerId === finger.id) lift(type === 'pointerup'); });
    }
    canvas.addEventListener('pointermove', (e) => {
      if (finger && e.pointerId === finger.id) return carry(e);
      // A mouse shows what can be clicked.
      if (e.pointerType === 'mouse' && !finger) canvas.style.cursor = targetAt(e.clientX, e.clientY) ? 'pointer' : '';
    });

    /** A finger held on an agent's desk, then moved, picks the agent up and carries them. */
    function carry(e) {
      const { x, y } = roomAt(e.clientX, e.clientY);
      if (!carrying) {
        if (!finger.held || finger.target.kind !== 'session') return;
        if (Math.hypot(e.clientX - finger.x, e.clientY - finger.y) < CARRY_AFTER) return;
        const from = office.seats.findIndex((s) => s.session && s.session.id === finger.target.id);
        if (from < 0) return;
        held = null;
        const person = office.people.find((p) => !p.isStaff && !p.isLeaving && p.session.id === finger.target.id) || null;
        carrying = { person, from, x, y, over: from };
        on.held?.();
      }
      const over = deskAt(x, y);
      if (over !== null && over !== carrying.over && over !== carrying.from) on.held?.(); // a tick for each desk passed over
      Object.assign(carrying, { x, y, over });
    }
    bind();
    resize();
    run();

    return {
      show(snapshot) {
        latest = snapshot;
        if (snapshot.now) gaps = [...gaps.slice(1 - CLOCK_SAMPLES), Date.now() - snapshot.now];
        ahead = gaps.length ? Math.min(...gaps) : 0;
        hiring = snapshot.hiring || { fire: false, hire: false };
        office.furnish(snapshot.layout && snapshot.layout.room);
        office.apply(seatsOf(snapshot, ahead), snapshot.theme, clock());
        // The question and what's held out go with their agent; a hire, once its desk is taken.
        const there = (id) => office.deskOfSession(id) !== null;
        if (firing && (!hiring.fire || !there(firing.id))) firing = null;
        if (held && (held.kind === 'session' ? !there(held.id) : !hiresInto(held.desk))) held = null;
      },
      close() {
        latest = null;
        gaps = [];
        office.close();
      },
      select(id) {
        // Another agent picked: what was held out for the last one goes away.
        if (held && held.kind === 'session' && held.id !== id) held = null;
        selected = id;
      },
      setVisible(shown) {
        visible = shown;
        if (shown) {
          resize();
          run();
          ambience.wake(host.window, loudness());
        } else {
          if (finger) lift();
          ambience.sleep();
        }
      },
      setFramed(shown) { framed = shown; },
      /** Floats the room's window in a 'window' of its own or a whole 'screen', fills it from 'edge' to edge, or stops, with null. */
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

  /** What a preview shows of the room, in the wide room's art pixels: round the corner piece, or round the first desk. */
  const PREVIEW_CROPS = {
    corner: { x: 238, y: 49, w: 80, h: 51 },
    workspace: { x: DESKS[0].x - 6, y: DESKS[0].y - 27, w: DESK_WIDTH + 14, h: 45 },
  };
  let previewRoom = null; // the canvas previews draw the whole room on
  /** Someone at a workspace in its preview, at ease, so no bubble hides it. */
  const PREVIEW_AGENT = {
    id: 'preview', name: 'preview', state: 'idle', effort: '', agent: 'claude', model: '', tool: 'Edit', subagents: [],
    maxPressedAt: null, turnStartedAt: null, dial: false, mic: false,
  };

  /**
   * One of the room's choices on its own, for the setup page to show it by:
   * `what` is { corner } with someone at each of its places, or
   * { workspace } with an agent at it. It's drawn by the room's own code in
   * the layout's `room` (its floor, paint and finishes), `now` seconds in,
   * and cut to the piece, as big as fits `canvas` in whole pixels. `tall`
   * shows it where the room held upright has it.
   */
  function preview(canvas, what, { room = null, now = 0, tall = false } = {}) {
    const kept = { decor, spots, boardSpots, shape };
    try {
      shape = tall ? TALL : WIDE;
      decor = roomOf({ ...room, ...what, team: null, staff: 'none', sky: 'day', pet: 'none' });
      spots = spotsOf(decor);
      boardSpots = boardSpotsOf(decor);
      const office = new Office();
      office.apply(what.workspace ? [{ pin: null, session: PREVIEW_AGENT }] : [], {}, now);
      if (what.corner) CORNER_SPOTS[decor.corner].forEach((_, i) => {
        const spot = LOUNGE_SPOTS.length + i, member = office.hireStaff();
        member.place = spotPlace(spot);
        member.position = { x: spots[spot].x, y: spots[spot].y };
        member.isFacingAway = facesAway(spots[spot].pose);
      });
      const crop = { ...PREVIEW_CROPS[what.workspace ? 'workspace' : 'corner'] };
      if (what.corner) Object.assign(crop, placed('corner', crop));
      const scale = Math.max(1, Math.floor(Math.min(canvas.width / crop.w, canvas.height / crop.h)));
      // One canvas for the whole room, kept from one preview to the next
      if (!previewRoom || previewRoom.ownerDocument !== canvas.ownerDocument) previewRoom = canvas.ownerDocument.createElement('canvas');
      const whole = previewRoom;
      whole.width = shape.width * scale; // clears it, too
      whole.height = shape.height * scale;
      drawOffice(whole.getContext('2d'), office, {
        now, hour: 12, minute: 0, month: 5, width: whole.width, height: whole.height, ratio: 1, selected: null,
        mic: { held: false, heldAt: null, releasedAt: null, listener: null, usable: true }, framed: false, floating: null,
      });
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = crop.w * scale, h = crop.h * scale;
      ctx.drawImage(whole, crop.x * scale, crop.y * scale, w, h,
        Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
    } finally {
      ({ decor, spots, boardSpots, shape } = kept);
    }
  }

  /** The pop-out window's size, in CSS pixels: two to each of the room's, and the margin round it. */
  const popOutSize = { width: WIDTH * 2 + FLOAT_MARGINS.window * 2, height: HEIGHT * 2 + FLOAT_MARGINS.window * 2 };

  /** The deck's reminder, on its own context: it plays whatever the office's volume is. */
  function remind(audio) {
    const soft = audio.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 7000;
    soft.Q.value = 0;
    soft.connect(audio.destination);
    remindSound(new Chip(audio, soft), audio.currentTime + 0.02);
  }

  // `preview` draws a piece for the setup page; `remind` is the deck's reminder; `Ambience` and `sounds` let
  // each of the office's sounds be tried on its own.
  window.AgentOffice = { create, popOutSize, preview, remind, Ambience, sounds: Object.keys(SOUNDS) };
})();
