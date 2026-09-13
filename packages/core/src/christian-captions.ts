// Christian/Ministry Caption Styles
// Faith-coded visual styles for sermon clips, worship content, testimony videos
// Designed for church social media: reverent, bold, accessible

import type { ASSStyle } from "./ass";

/**
 * Christian-specific caption styles with faith-appropriate colors and fonts
 */
export const CHRISTIAN_CAPTION_STYLES: Record<string, ASSStyle> = {
  // 1. Holy Glow - reverent white with soft golden glow
  holy_glow: {
    name: "HolyGlow",
    fontname: "Arial",
    fontsize: 54,
    primaryColor: 0x00FFFFFF, // white
    secondaryColor: 0x0000AAFF, // gold
    outlineColor: 0x0000AAFF, // gold outline
    shadowColor: 0x0000AAFF, // gold shadow
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 8, // large soft glow
    alignment: 2, // bottom center
    marginL: 40,
    marginR: 40,
    marginV: 70,
    encoding: 1,
  },

  // 2. Cross Bold - strong black text with white cross-shaped outline
  cross_bold: {
    name: "CrossBold",
    fontname: "Arial Black",
    fontsize: 58,
    primaryColor: 0x00000000, // black
    secondaryColor: 0x00FFFFFF, // white
    outlineColor: 0x00FFFFFF, // white thick outline
    shadowColor: 0x00808080, // gray shadow
    bold: 1,
    italic: 0,
    outline: 5, // thick for visibility
    shadow: 3,
    alignment: 2,
    marginL: 35,
    marginR: 35,
    marginV: 65,
    encoding: 1,
  },

  // 3. Worship Purple - regal purple for praise/worship content
  worship_purple: {
    name: "WorshipPurple",
    fontname: "Georgia",
    fontsize: 52,
    primaryColor: 0x00FFFFFF, // white text
    secondaryColor: 0x00800080, // purple
    outlineColor: 0x00800080, // deep purple outline
    shadowColor: 0x004B0082, // indigo shadow
    bold: 1,
    italic: 1, // slight italic for elegance
    outline: 4,
    shadow: 4,
    alignment: 2,
    marginL: 45,
    marginR: 45,
    marginV: 75,
    encoding: 1,
  },

  // 4. Scripture Serif - traditional serif for Bible verse overlays
  scripture_serif: {
    name: "ScriptureSerif",
    fontname: "Times New Roman",
    fontsize: 48,
    primaryColor: 0x00F5F5DC, // beige/cream
    secondaryColor: 0x008B4513, // saddle brown
    outlineColor: 0x008B4513, // brown outline
    shadowColor: 0x00000000, // black shadow
    bold: 1,
    italic: 1,
    outline: 2,
    shadow: 2,
    alignment: 5, // center (for verse overlays)
    marginL: 60,
    marginR: 60,
    marginV: 0,
    encoding: 1,
  },

  // 5. Fire Revival - bold orange/red for revival/passion messages
  fire_revival: {
    name: "FireRevival",
    fontname: "Impact",
    fontsize: 60,
    primaryColor: 0x00FFFFFF, // white
    secondaryColor: 0x000000FF, // red
    outlineColor: 0x000047FF, // orange-red outline
    shadowColor: 0x00000000, // black shadow
    bold: 1,
    italic: 0,
    outline: 4,
    shadow: 5,
    alignment: 2,
    marginL: 30,
    marginR: 30,
    marginV: 60,
    encoding: 1,
  },
};
