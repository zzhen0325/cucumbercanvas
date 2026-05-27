import type { IconLookupFn } from "@cucumber/pen-renderer";

export type CanvasIconEntry = {
  name: string;
  label: string;
  tags: string[];
  d: string;
  style: "stroke" | "fill";
};

const STROKE = "stroke" as const;

export const CANVAS_ICON_LIBRARY: CanvasIconEntry[] = [
  {
    name: "search",
    label: "Search",
    tags: ["find", "magnifier"],
    d: "M21 21l-4.3-4.3 M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15",
    style: STROKE,
  },
  {
    name: "bell",
    label: "Bell",
    tags: ["notification", "alert"],
    d: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0",
    style: STROKE,
  },
  {
    name: "user",
    label: "User",
    tags: ["person", "profile", "account"],
    d: "M19 21a7 7 0 0 0-14 0 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    style: STROKE,
  },
  {
    name: "heart",
    label: "Heart",
    tags: ["like", "favorite"],
    d: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8",
    style: STROKE,
  },
  {
    name: "star",
    label: "Star",
    tags: ["favorite", "rating"],
    d: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1z",
    style: STROKE,
  },
  {
    name: "plus",
    label: "Plus",
    tags: ["add", "create"],
    d: "M12 5v14 M5 12h14",
    style: STROKE,
  },
  {
    name: "x",
    label: "Close",
    tags: ["remove", "dismiss"],
    d: "M18 6 6 18 M6 6l12 12",
    style: STROKE,
  },
  {
    name: "check",
    label: "Check",
    tags: ["done", "success"],
    d: "M20 6 9 17l-5-5",
    style: STROKE,
  },
  {
    name: "arrow-right",
    label: "Arrow Right",
    tags: ["next", "forward"],
    d: "M5 12h14 M13 5l7 7-7 7",
    style: STROKE,
  },
  {
    name: "settings",
    label: "Settings",
    tags: ["gear", "preferences"],
    d: "M12.2 2h-.4l-1 2.6a7.8 7.8 0 0 0-1.8.7L6.6 4.2 4.2 6.6 5.3 9a7.8 7.8 0 0 0-.7 1.8L2 11.8v.4l2.6 1c.2.6.4 1.2.7 1.8l-1.1 2.4 2.4 2.4 2.4-1.1c.6.3 1.2.5 1.8.7l1 2.6h.4l1-2.6c.6-.2 1.2-.4 1.8-.7l2.4 1.1 2.4-2.4-1.1-2.4c.3-.6.5-1.2.7-1.8l2.6-1v-.4l-2.6-1a7.8 7.8 0 0 0-.7-1.8l1.1-2.4-2.4-2.4-2.4 1.1a7.8 7.8 0 0 0-1.8-.7z M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
    style: STROKE,
  },
  {
    name: "home",
    label: "Home",
    tags: ["house", "dashboard"],
    d: "M3 10.5 12 3l9 7.5 M5 10v10h14V10 M9 20v-6h6v6",
    style: STROKE,
  },
  {
    name: "image",
    label: "Image",
    tags: ["picture", "media"],
    d: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2 M8.5 8.5h.01 M21 15l-5-5L5 21",
    style: STROKE,
  },
  {
    name: "message-square",
    label: "Message",
    tags: ["chat", "comment"],
    d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z",
    style: STROKE,
  },
  {
    name: "lock",
    label: "Lock",
    tags: ["secure", "private"],
    d: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
    style: STROKE,
  },
  {
    name: "mail",
    label: "Mail",
    tags: ["email", "inbox"],
    d: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M22 6l-10 7L2 6",
    style: STROKE,
  },
  {
    name: "play",
    label: "Play",
    tags: ["start", "video"],
    d: "M5 3l14 9-14 9z",
    style: STROKE,
  },
  {
    name: "upload",
    label: "Upload",
    tags: ["import", "cloud"],
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
    style: STROKE,
  },
  {
    name: "download",
    label: "Download",
    tags: ["export", "save"],
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
    style: STROKE,
  },
  {
    name: "trash",
    label: "Trash",
    tags: ["delete", "remove"],
    d: "M3 6h18 M8 6V4h8v2 M19 6l-1 15H6L5 6 M10 11v6 M14 11v6",
    style: STROKE,
  },
];

const ICON_LOOKUP = new Map(
  CANVAS_ICON_LIBRARY.map((icon) => [icon.name.toLowerCase(), icon]),
);

export const lookupCanvasIcon: IconLookupFn = (name) => {
  const key = name.trim().toLowerCase();
  const icon =
    ICON_LOOKUP.get(key) ?? ICON_LOOKUP.get(key.replace(/^lucide:/, ""));
  return icon
    ? { d: icon.d, iconId: `lucide:${icon.name}`, style: icon.style }
    : null;
};
