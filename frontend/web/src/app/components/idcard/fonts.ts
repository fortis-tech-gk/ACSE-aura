import { Cinzel, Cinzel_Decorative, Montserrat } from 'next/font/google';

/** Self-hosted at build time, so printed / saved-PDF cards never fall back to a system font */
export const idDisplay = Cinzel_Decorative({ subsets: ['latin'], weight: ['700', '900'], variable: '--idc-display', display: 'block' });
export const idSerif = Cinzel({ subsets: ['latin'], weight: ['600', '700', '800', '900'], variable: '--idc-serif', display: 'block' });
export const idSans = Montserrat({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--idc-sans', display: 'block' });

export const idFontVars = `${idDisplay.variable} ${idSerif.variable} ${idSans.variable}`;
