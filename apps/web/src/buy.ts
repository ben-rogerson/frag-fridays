// One-click loadouts for the tab screen's buy pad.
//
// WHY THIS EXISTS. New players lose the first thirty seconds of every round to
// the stock buy menu: nine keypresses through nested numbered submenus, in a
// mode where they are usually dead before they finish. The pad turns the four
// or five loadouts anyone actually wants into one click each.
//
// HOW IT WORKS, AND WHY IT IS THIS CHEAP. Every string below is a console
// command. The buy aliases are registered in the SERVER dll
// (cs_emscripten_wasm32.wasm), not the client, so the engine does not know
// them and forwards each one to the server as an ordinary stringcmd - the
// exact path a player typing `ak47` into the console takes. That means the
// pad needs no plugin, no new network message, no per-frame work and nothing
// to keep in sync: it rides the usercmd channel already carrying movement.
// See sendCommand in launch.ts for the one safety gate it does need.
//
// THE ALIASES ARE NOT THE ONES YOU REMEMBER. They were read out of the wasm's
// string tables rather than from memory of retail 1.6, because this build's
// names differ:
//
//   awp sg550 g3sg1 scout
//   sg552 aug ak47 m4a1 galil famas
//   deagle elites fn57 usp glock p228 shield
//   p90 ump45 mp5 tmp mac10
//   xm1014 m3
//   vest vesthelm hegren sgren nvgs primammo secammo buyammo1 buyammo2
//
// Note `elites` (not `elite`) and `fn57` (not `fiveseven`). Three names that
// retail has and this table does not - `flash`, `defuser`, `m249` - are
// deliberately absent from the kits below rather than guessed at; an alias the
// server does not know is silently forwarded, does nothing, and leaves the
// player wondering why one button in a row is dead. Add them once they have
// been typed into the in-game console and seen to work.
//
// ORDER MATTERS. Guns first, armour last: the server buys until the money runs
// out and refuses the rest, so a kit that cannot be afforded in full should
// still land the gun. Armour is the cheap part and the part you can pick up
// from the floor.

/** Which mark from buyicons.tsx a kit wears. A name for the drawing, not for
 *  the weapon: the awp and the scout are one family drawn at two sizes, and
 *  both rifles share the one rifle. */
export type KitIcon = "rifle" | "sniper" | "scout" | "smg" | "pistol" | "vest" | "grenade";

export type Loadout = {
  /** stable key, also the React list key */
  id: string;
  /** what the button says */
  label: string;
  /** the second line - what you get, in players' words, not alias names */
  detail: string;
  /** roughly what it costs, for the button's corner. Not enforced here - the
   *  server is the only thing that decides whether a purchase happens. */
  price: number;
  /** the pictogram on the button, resolved through KIT_ICONS */
  icon: KitIcon;
  /** console commands, in the order they are sent */
  cmds: string[];
  /** T only, CT only, or both. Rifles differ by side; the rest do not. */
  team?: "t" | "ct";
};

// The full-armour prefix every kit ends with. vesthelm buys the helmet AND the
// vest, and is refused outright (not partially) when you already have both, so
// sending it unconditionally costs nothing.
const ARMOUR = "vesthelm";

// primammo/secammo top up whatever you are holding, so they come after the gun
// and work for every kit without naming a calibre.
const AMMO = ["primammo", "secammo"];

export const LOADOUTS: Loadout[] = [
  {
    id: "rifle-t",
    label: "Rifle",
    detail: "AK-47, armour, ammo",
    price: 3600,
    icon: "rifle",
    cmds: ["ak47", ...AMMO, ARMOUR],
    team: "t",
  },
  {
    id: "rifle-ct",
    label: "Rifle",
    detail: "M4A1, armour, ammo",
    price: 4000,
    icon: "rifle",
    cmds: ["m4a1", ...AMMO, ARMOUR],
    team: "ct",
  },
  {
    id: "awp",
    label: "AWP",
    detail: "sniper, armour, ammo",
    price: 5700,
    icon: "sniper",
    cmds: ["awp", ...AMMO, ARMOUR],
  },
  {
    id: "smg",
    label: "SMG",
    detail: "MP5, armour, ammo",
    price: 2150,
    icon: "smg",
    cmds: ["mp5", ...AMMO, ARMOUR],
  },
  {
    id: "scout",
    label: "Scout",
    detail: "cheap sniper, armour",
    price: 3350,
    icon: "scout",
    cmds: ["scout", ...AMMO, ARMOUR],
  },
  {
    id: "pistol",
    label: "Pistol round",
    detail: "Deagle, armour",
    price: 1650,
    icon: "pistol",
    cmds: ["deagle", ...AMMO, ARMOUR],
  },
  {
    id: "armour",
    label: "Armour",
    detail: "vest and helmet",
    price: 1000,
    icon: "vest",
    cmds: [ARMOUR],
  },
  {
    id: "nade",
    label: "Grenade",
    detail: "one HE",
    price: 300,
    icon: "grenade",
    cmds: ["hegren"],
  },
];

// The kits for a side. Team comes off the scoreboard feed (1 = T, 2 = CT);
// anything else - spectator, still on the join screen, or a box running a
// statusjson too old to send the field - is "no side yet", and the honest
// answer there is to show the side-neutral kits rather than guess a rifle.
export function loadoutsFor(team: number | undefined): Loadout[] {
  const side = team === 1 ? "t" : team === 2 ? "ct" : null;
  return LOADOUTS.filter((l) => !l.team || l.team === side);
}
