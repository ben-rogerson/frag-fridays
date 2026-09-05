// The buy pad's pictograms.
//
// Same drawing family as the mode emblems in App.tsx - 40x40 box, no fill,
// one currentColor stroke at 2.5 - so the two icon sets read as one hand even
// though they never appear on screen together. Round caps and joins are the
// one addition: these marks carry more detail than an emblem does and are
// drawn at roughly half the size, where a mitred corner turns into a spike.
//
// They are a second way to find a button, not the only way: every kit still
// says its name, its contents and its price in words. A player who cannot
// tell the scout from the awp at a glance has lost nothing, and a player
// reaching for "the sniper one" for the tenth time this session has gained
// the thing icons are actually for.
//
// The scout is deliberately the awp's mark drawn smaller and shorter rather
// than a different weapon: they ARE the same weapon class, and "cheaper,
// lighter version of that one" is the useful thing to say about it.
import type { FC } from "react";
import type { KitIcon } from "./buy";

const Mark: FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    className="tabscreen__kiticon"
    viewBox="0 0 40 40"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

// assault rifle: receiver, long barrel, curved-off magazine, shouldered stock
const Rifle: FC = () => (
  <Mark>
    <path d="M10 16h18v6H10z" />
    <path d="M28 19h9" />
    <path d="M10 20l-7 5" />
    <path d="M16 22l-1 8h6l-1-8" />
  </Mark>
);

// sniper: the scope on top is the whole tell, so it gets the most room
const Sniper: FC = () => (
  <Mark>
    <path d="M13 13h11v4H13z" />
    <path d="M18 17v4" />
    <path d="M9 21h15v5H9z" />
    <path d="M24 23h13" />
    <path d="M9 24l-6 4" />
  </Mark>
);

const Scout: FC = () => (
  <Mark>
    <path d="M15 15h8v4h-8z" />
    <path d="M19 19v2" />
    <path d="M12 21h12v5H12z" />
    <path d="M24 23h8" />
    <path d="M12 24l-5 4" />
  </Mark>
);

// smg: a deeper body, a stub of a barrel and no stock at all, against the
// rifle's long barrel and shouldered stock - the pair only has to be told
// apart from each other, not identified cold
const Smg: FC = () => (
  <Mark>
    <path d="M10 14h16v8H10z" />
    <path d="M26 18h5" />
    <path d="M16 22l-1 8h6l-1-8" />
  </Mark>
);

// pistol: slide and grip in one outline, the one silhouette here that needs
// no explaining at any size
const Pistol: FC = () => (
  <Mark>
    <path d="M9 14h20v6h-9l-3 10h-6l3-10H9z" />
  </Mark>
);

// armour: the vest, not the helmet. Both are in the kit and the button says
// so; a helmet drawn on top of this at 26px would be three strokes of mud.
const Vest: FC = () => (
  <Mark>
    <path d="M15 9l5 3 5-3 6 3v8h-4v12H13V20H9v-8z" />
  </Mark>
);

// The flat cap and the lever are what stop this reading as a balloon: a bare
// circle at this size is any round object at all.
const Grenade: FC = () => (
  <Mark>
    <path d="M16 13h7v5h-7z" />
    <path d="M23 14l6-2" />
    <circle cx="31" cy="11" r="2.5" />
    <path d="M12 18h15v7a7.5 7.5 0 0 1-15 0z" />
  </Mark>
);

// Keyed by the icon names buy.ts hands out, and typed against that union, so
// a kit added there without a mark is a build error rather than a blank
// square nobody notices until it is live.
export const KIT_ICONS: Record<KitIcon, FC> = {
  rifle: Rifle,
  sniper: Sniper,
  scout: Scout,
  smg: Smg,
  pistol: Pistol,
  vest: Vest,
  grenade: Grenade,
};

// The buy zone cart, drawn to match the one the game puts in your hud when
// you are standing in a zone. It heads the pad AND is named by the line under
// it ("where this cart shows in your hud"), which is the only reason it is
// here: it is the pad's way of pointing at something on the other screen.
export const CartIcon: FC = () => (
  <svg
    className="tabscreen__cart"
    viewBox="0 0 40 40"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 5h5l5 20" />
    <path d="M10 10h28l-8 15H13" />
    <circle cx="17" cy="31" r="2.5" />
    <circle cx="28" cy="31" r="2.5" />
  </svg>
);
