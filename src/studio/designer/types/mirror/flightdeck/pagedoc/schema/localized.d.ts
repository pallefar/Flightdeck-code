import { z } from "../../../../vendor/zod/v4/index.js";
export declare const LOCALES: readonly ["en", "de"];
export type Locale = (typeof LOCALES)[number];
export declare const localeSchema: z.ZodEnum<{
    en: "en";
    de: "de";
}>;
export declare const basisSchema: z.ZodObject<{
    en: z.ZodOptional<z.ZodString>;
    de: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Wraps a per-locale value schema into {en?, de?, basis?}, with at least one
 * locale present and a basis only for a locale that is present. */
export declare function localized<T extends z.ZodType>(value: T): z.ZodObject<{
    en: z.ZodOptional<T>;
    de: z.ZodOptional<T>;
    basis: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Plain text in one locale: non-blank, bounded, no control characters. */
export declare function plainText(maxChars: number): z.ZodString;
export declare const localizedPlain: (maxChars: number) => z.ZodObject<{
    en: z.ZodOptional<z.ZodString>;
    de: z.ZodOptional<z.ZodString>;
    basis: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
