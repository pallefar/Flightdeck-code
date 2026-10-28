import { z } from "../../../../vendor/zod/v4/index.js";
export declare const idSchema: z.ZodString;
/**
 * A media library item id. The doc never holds a URL: each host resolves the
 * id through its own adapter (adapters.ts mediaUrl) behind its own rights
 * check, so a doc cannot point a reader at an arbitrary origin.
 */
export declare const mediaIdSchema: z.ZodString;
/** A bare reference to a library item (a video poster, a captions file). */
export declare const mediaFileRefSchema: z.ZodObject<{
    mediaId: z.ZodString;
}, z.core.$strict>;
export type MediaFileRef = z.infer<typeof mediaFileRefSchema>;
/** Alt text is stored per use in the doc (plan: approval covers alt text and
 * captions), and an image without alt must say it is decorative. */
export declare const ALT_OR_DECORATIVE = "an image needs alt text or decorative: true (not both)";
export declare const hasAltXorDecorative: (m: {
    alt?: unknown;
    decorative?: unknown;
}) => boolean;
/** An inline image (hero, feature item): library id plus its per-use alt. */
export declare const mediaRefSchema: z.ZodObject<{
    mediaId: z.ZodString;
    alt: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    decorative: z.ZodOptional<z.ZodLiteral<true>>;
}, z.core.$strict>;
export type MediaRef = z.infer<typeof mediaRefSchema>;
/** A sub-app id (the SUBAPP_ID_RE convention, bounded). */
export declare const appIdSchema: z.ZodString;
/** The immutable page_id (a lower-case UUID), never a slug, so renaming a page never breaks a link. */
export declare const pageIdSchema: z.ZodString;
/** What a call-to-action does. A link must be https (isSafeHref, and no mailto: or path). */
export declare const ctaActionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"openApp">;
    appId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"requestAccess">;
    appId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"openPage">;
    pageId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"openUrl">;
    url: z.ZodString;
}, z.core.$strict>]>;
export type CtaAction = z.infer<typeof ctaActionSchema>;
export declare const CTA_STYLES: readonly ["primary", "secondary"];
/** A button: its label, look and action. Stored in the doc, so approval covers the destination. */
export declare const ctaButtonSchema: z.ZodObject<{
    label: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    style: z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"openApp">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"requestAccess">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openPage">;
        pageId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openUrl">;
        url: z.ZodString;
    }, z.core.$strict>]>;
}, z.core.$strict>;
export type CtaButton = z.infer<typeof ctaButtonSchema>;
export declare const heroBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"hero">;
    heading: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    subheading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    media: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
    }, z.core.$strict>>;
    cta: z.ZodOptional<z.ZodObject<{
        label: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        style: z.ZodEnum<{
            primary: "primary";
            secondary: "secondary";
        }>;
        action: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"openApp">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"requestAccess">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openPage">;
            pageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openUrl">;
            url: z.ZodString;
        }, z.core.$strict>]>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const richTextBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"richText">;
    content: z.ZodObject<{
        en: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"paragraph">;
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"heading">;
            level: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"bulletList">;
            items: z.ZodArray<z.ZodObject<{
                content: z.ZodArray<z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"bold">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"italic">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"code">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"link">;
                        href: z.ZodString;
                    }, z.core.$strict>]>>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"orderedList">;
            items: z.ZodArray<z.ZodObject<{
                content: z.ZodArray<z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"bold">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"italic">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"code">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"link">;
                        href: z.ZodString;
                    }, z.core.$strict>]>>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>]>>>;
        de: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"paragraph">;
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"heading">;
            level: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"bulletList">;
            items: z.ZodArray<z.ZodObject<{
                content: z.ZodArray<z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"bold">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"italic">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"code">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"link">;
                        href: z.ZodString;
                    }, z.core.$strict>]>>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"orderedList">;
            items: z.ZodArray<z.ZodObject<{
                content: z.ZodArray<z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                    marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        type: z.ZodLiteral<"bold">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"italic">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"code">;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"link">;
                        href: z.ZodString;
                    }, z.core.$strict>]>>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>]>>>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const dividerBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"divider">;
}, z.core.$strict>;
export declare const CORE_BLOCK_TYPES: readonly ["hero", "richText", "divider"];
