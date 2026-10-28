import { z } from "../../../../vendor/zod/v4/index.js";
export declare const SECTION_LAYOUTS: readonly ["1", "1-1", "2-1", "1-2", "1-1-1"];
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];
/** How many columns each layout has. */
export declare function columnCount(layout: SectionLayout): number;
export declare const SECTION_EMPHASIS: readonly ["none", "subtle", "strong"];
export declare const SECTION_SPACING: readonly ["compact", "normal", "spacious"];
export declare const SECTION_PHONE: readonly ["stack", "hide-second"];
/** 'content-only': text and media stay editable, blocks cannot be moved, added or removed (plan J17). */
export declare const SECTION_LOCK: readonly ["none", "content-only"];
export declare const columnSchema: z.ZodObject<{
    id: z.ZodString;
    blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"divider">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"media">;
        kind: z.ZodEnum<{
            video: "video";
            image: "image";
        }>;
        mediaRef: z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
        caption: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        focal: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strict>>;
        posterRef: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
        captions: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
            de: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"gallery">;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaRef: z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
            caption: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"featureGrid">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            text: z.ZodOptional<z.ZodObject<{
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
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"benefits">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            text: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"faq">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            q: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            a: z.ZodObject<{
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
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"cta">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
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
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"appCards">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"widget">;
        widgetId: z.ZodString;
        config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"tabs">;
        tabs: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
            }, z.core.$strict>, z.ZodObject<{
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
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"divider">;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"media">;
                kind: z.ZodEnum<{
                    video: "video";
                    image: "image";
                }>;
                mediaRef: z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
                caption: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                focal: z.ZodOptional<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, z.core.$strict>>;
                posterRef: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
                captions: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodObject<{
                        mediaId: z.ZodString;
                    }, z.core.$strict>>;
                    de: z.ZodOptional<z.ZodObject<{
                        mediaId: z.ZodString;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"gallery">;
                items: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    mediaRef: z.ZodObject<{
                        mediaId: z.ZodString;
                    }, z.core.$strict>;
                    alt: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    decorative: z.ZodOptional<z.ZodLiteral<true>>;
                    caption: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"featureGrid">;
                heading: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                items: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    title: z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                    text: z.ZodOptional<z.ZodObject<{
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
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"benefits">;
                heading: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                items: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    title: z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                    text: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"faq">;
                heading: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                items: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    q: z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                    a: z.ZodObject<{
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
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"cta">;
                heading: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                text: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
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
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"appCards">;
                heading: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
            }, z.core.$strict>, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"widget">;
                widgetId: z.ZodString;
                config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
            }, z.core.$strict>]>>;
        }, z.core.$strict>>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export type Column = z.infer<typeof columnSchema>;
export declare const sectionSchema: z.ZodObject<{
    id: z.ZodString;
    layout: z.ZodEnum<{
        1: "1";
        "1-1": "1-1";
        "2-1": "2-1";
        "1-2": "1-2";
        "1-1-1": "1-1-1";
    }>;
    emphasis: z.ZodEnum<{
        none: "none";
        strong: "strong";
        subtle: "subtle";
    }>;
    spacing: z.ZodEnum<{
        normal: "normal";
        compact: "compact";
        spacious: "spacious";
    }>;
    phone: z.ZodEnum<{
        stack: "stack";
        "hide-second": "hide-second";
    }>;
    lock: z.ZodOptional<z.ZodEnum<{
        none: "none";
        "content-only": "content-only";
    }>>;
    columns: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"divider">;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"media">;
            kind: z.ZodEnum<{
                video: "video";
                image: "image";
            }>;
            mediaRef: z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
            caption: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            focal: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strict>>;
            posterRef: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
            captions: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
                de: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"gallery">;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaRef: z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
                caption: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"featureGrid">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                text: z.ZodOptional<z.ZodObject<{
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
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"benefits">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                text: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"faq">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                q: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                a: z.ZodObject<{
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
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"cta">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            text: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
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
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"appCards">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"widget">;
            widgetId: z.ZodString;
            config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"tabs">;
            tabs: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                label: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>, z.ZodObject<{
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
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"divider">;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"media">;
                    kind: z.ZodEnum<{
                        video: "video";
                        image: "image";
                    }>;
                    mediaRef: z.ZodObject<{
                        mediaId: z.ZodString;
                    }, z.core.$strict>;
                    alt: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    decorative: z.ZodOptional<z.ZodLiteral<true>>;
                    caption: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    focal: z.ZodOptional<z.ZodObject<{
                        x: z.ZodNumber;
                        y: z.ZodNumber;
                    }, z.core.$strict>>;
                    posterRef: z.ZodOptional<z.ZodObject<{
                        mediaId: z.ZodString;
                    }, z.core.$strict>>;
                    captions: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodObject<{
                            mediaId: z.ZodString;
                        }, z.core.$strict>>;
                        de: z.ZodOptional<z.ZodObject<{
                            mediaId: z.ZodString;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"gallery">;
                    items: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        mediaRef: z.ZodObject<{
                            mediaId: z.ZodString;
                        }, z.core.$strict>;
                        alt: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                            basis: z.ZodOptional<z.ZodObject<{
                                en: z.ZodOptional<z.ZodString>;
                                de: z.ZodOptional<z.ZodString>;
                            }, z.core.$strict>>;
                        }, z.core.$strict>>;
                        decorative: z.ZodOptional<z.ZodLiteral<true>>;
                        caption: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                            basis: z.ZodOptional<z.ZodObject<{
                                en: z.ZodOptional<z.ZodString>;
                                de: z.ZodOptional<z.ZodString>;
                            }, z.core.$strict>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"featureGrid">;
                    heading: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    items: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        title: z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                            basis: z.ZodOptional<z.ZodObject<{
                                en: z.ZodOptional<z.ZodString>;
                                de: z.ZodOptional<z.ZodString>;
                            }, z.core.$strict>>;
                        }, z.core.$strict>;
                        text: z.ZodOptional<z.ZodObject<{
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
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"benefits">;
                    heading: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    items: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        title: z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                            basis: z.ZodOptional<z.ZodObject<{
                                en: z.ZodOptional<z.ZodString>;
                                de: z.ZodOptional<z.ZodString>;
                            }, z.core.$strict>>;
                        }, z.core.$strict>;
                        text: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                            basis: z.ZodOptional<z.ZodObject<{
                                en: z.ZodOptional<z.ZodString>;
                                de: z.ZodOptional<z.ZodString>;
                            }, z.core.$strict>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"faq">;
                    heading: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    items: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        q: z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                            basis: z.ZodOptional<z.ZodObject<{
                                en: z.ZodOptional<z.ZodString>;
                                de: z.ZodOptional<z.ZodString>;
                            }, z.core.$strict>>;
                        }, z.core.$strict>;
                        a: z.ZodObject<{
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
                    }, z.core.$strict>>;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"cta">;
                    heading: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    text: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
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
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"appCards">;
                    heading: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
                }, z.core.$strict>, z.ZodObject<{
                    id: z.ZodString;
                    type: z.ZodLiteral<"widget">;
                    widgetId: z.ZodString;
                    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
                }, z.core.$strict>]>>;
            }, z.core.$strict>>;
        }, z.core.$strict>]>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Section = z.infer<typeof sectionSchema>;
