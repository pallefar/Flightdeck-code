import { z } from "../vendor/zod/v4/index.js";
import { type PageDocV2 } from '../mirror/flightdeck/pagedoc/schema/index.js';
/** Context is an association supplied by an authenticated host, NEVER authority. */
export interface DesignerContext {
    workspaceId: string;
    projectId: string; /** Exact current page writer's actorOf(req) username, matching readback.by; not a display label or an assumed database UUID. */
    actorId: string;
    epoch: string;
}
export interface OsPageTarget {
    kind: 'os-project';
    pageId: string;
}
export interface NativeReadback {
    context: DesignerContext;
    target: OsPageTarget;
    rev: number;
    doc: unknown;
    by: string | null;
}
export interface NativeCommit {
    rev: number;
    sha256: string;
}
/** Trusted adapter-only evidence of a definite rejection before any commit. */
export interface NativeWriteRefusal {
    status: 'refused';
    reason: 'conflict' | 'forbidden' | 'invalid' | 'not-found';
}
export interface NativeAttempt {
    id: string;
    context: DesignerContext;
    target: OsPageTarget;
    baseRev: number;
    doc: PageDocV2;
}
/** Trusted in-process host adapter. Rechecks canonical auth/context/CAS server-side. */
export interface NativePageAdapter {
    write(attempt: Readonly<NativeAttempt>): Promise<NativeCommit | NativeWriteRefusal>;
    read(context: Readonly<DesignerContext>, target: Readonly<OsPageTarget>): Promise<NativeReadback>;
}
export interface NativeBinding {
    context: DesignerContext;
    target: OsPageTarget;
    baseRev: number;
    adapter: NativePageAdapter;
}
export type NativeSaveResult = {
    status: 'saved';
    rev: number;
    doc: PageDocV2;
} | {
    status: 'refused' | 'uncertain';
    reason: string;
};
export declare const contextSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    projectId: z.ZodString;
    actorId: z.ZodString;
    epoch: z.ZodString;
}, z.core.$strict>;
export declare function detachDocument(input: unknown): PageDocV2;
export declare function documentBytes(input: unknown): string;
export declare function documentSHA256(input: unknown): Promise<string>;
/** Only a trusted adapter's definite rejection BEFORE commit may use this class. */
export declare class NativePrecommitRefusal extends Error {
    readonly reason: 'conflict' | 'forbidden' | 'invalid' | 'not-found';
    constructor(reason: 'conflict' | 'forbidden' | 'invalid' | 'not-found');
}
export declare function snapshotNativeBinding(binding: NativeBinding): NativeBinding;
export declare function createNativeSession(input: NativeBinding): {
    snapshot: () => {
        status: "idle" | "uncertain" | "reading" | "saving" | "reconciling" | "retired";
        baseRev: number;
        context: DesignerContext;
        target: OsPageTarget;
        attempt: NativeAttempt | null;
    };
    retire(): void;
    save(input: unknown): Promise<NativeSaveResult>;
    reconcile(): Promise<NativeSaveResult>;
    reopen(): Promise<{
        doc: {
            schemaVersion: 2;
            meta: {
                sourceLocale: "en" | "de";
                title: {
                    en?: string | undefined;
                    de?: string | undefined;
                    basis?: {
                        en?: string | undefined;
                        de?: string | undefined;
                    } | undefined;
                };
                description?: {
                    en?: string | undefined;
                    de?: string | undefined;
                    basis?: {
                        en?: string | undefined;
                        de?: string | undefined;
                    } | undefined;
                } | undefined;
                theme?: "accent" | "default" | "calm" | undefined;
            };
            sections: {
                id: string;
                layout: "1" | "1-1" | "2-1" | "1-2" | "1-1-1";
                emphasis: "none" | "strong" | "subtle";
                spacing: "normal" | "compact" | "spacious";
                phone: "stack" | "hide-second";
                columns: {
                    id: string;
                    blocks: ({
                        id: string;
                        type: "media";
                        kind: "video" | "image";
                        mediaRef: {
                            mediaId: string;
                        };
                        alt?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                        decorative?: true | undefined;
                        caption?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                        focal?: {
                            x: number;
                            y: number;
                        } | undefined;
                        posterRef?: {
                            mediaId: string;
                        } | undefined;
                        captions?: {
                            en?: {
                                mediaId: string;
                            } | undefined;
                            de?: {
                                mediaId: string;
                            } | undefined;
                        } | undefined;
                    } | {
                        id: string;
                        type: "appCards";
                        heading?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                        appIds?: string[] | undefined;
                        source?: "all-visible" | undefined;
                    } | {
                        id: string;
                        type: "hero";
                        heading: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        };
                        subheading?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                        media?: {
                            mediaId: string;
                            alt?: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            } | undefined;
                            decorative?: true | undefined;
                        } | undefined;
                        cta?: {
                            label: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            };
                            style: "primary" | "secondary";
                            action: {
                                type: "openApp";
                                appId: string;
                            } | {
                                type: "requestAccess";
                                appId: string;
                            } | {
                                type: "openPage";
                                pageId: string;
                            } | {
                                type: "openUrl";
                                url: string;
                            };
                        } | undefined;
                    } | {
                        id: string;
                        type: "richText";
                        content: {
                            en?: ({
                                type: "paragraph";
                                content: {
                                    type: "text";
                                    text: string;
                                    marks?: ({
                                        type: "bold";
                                    } | {
                                        type: "italic";
                                    } | {
                                        type: "code";
                                    } | {
                                        type: "link";
                                        href: string;
                                    })[] | undefined;
                                }[];
                            } | {
                                type: "heading";
                                level: 2 | 3;
                                content: {
                                    type: "text";
                                    text: string;
                                    marks?: ({
                                        type: "bold";
                                    } | {
                                        type: "italic";
                                    } | {
                                        type: "code";
                                    } | {
                                        type: "link";
                                        href: string;
                                    })[] | undefined;
                                }[];
                            } | {
                                type: "bulletList";
                                items: {
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                }[];
                            } | {
                                type: "orderedList";
                                items: {
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                }[];
                            })[] | undefined;
                            de?: ({
                                type: "paragraph";
                                content: {
                                    type: "text";
                                    text: string;
                                    marks?: ({
                                        type: "bold";
                                    } | {
                                        type: "italic";
                                    } | {
                                        type: "code";
                                    } | {
                                        type: "link";
                                        href: string;
                                    })[] | undefined;
                                }[];
                            } | {
                                type: "heading";
                                level: 2 | 3;
                                content: {
                                    type: "text";
                                    text: string;
                                    marks?: ({
                                        type: "bold";
                                    } | {
                                        type: "italic";
                                    } | {
                                        type: "code";
                                    } | {
                                        type: "link";
                                        href: string;
                                    })[] | undefined;
                                }[];
                            } | {
                                type: "bulletList";
                                items: {
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                }[];
                            } | {
                                type: "orderedList";
                                items: {
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                }[];
                            })[] | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        };
                    } | {
                        id: string;
                        type: "divider";
                    } | {
                        id: string;
                        type: "gallery";
                        items: {
                            id: string;
                            mediaRef: {
                                mediaId: string;
                            };
                            alt?: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            } | undefined;
                            decorative?: true | undefined;
                            caption?: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            } | undefined;
                        }[];
                    } | {
                        id: string;
                        type: "featureGrid";
                        items: {
                            id: string;
                            title: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            };
                            text?: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            } | undefined;
                            media?: {
                                mediaId: string;
                                alt?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                                decorative?: true | undefined;
                            } | undefined;
                        }[];
                        heading?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                    } | {
                        id: string;
                        type: "benefits";
                        items: {
                            id: string;
                            title: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            };
                            text?: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            } | undefined;
                        }[];
                        heading?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                    } | {
                        id: string;
                        type: "faq";
                        items: {
                            id: string;
                            q: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            };
                            a: {
                                en?: ({
                                    type: "paragraph";
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                } | {
                                    type: "heading";
                                    level: 2 | 3;
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                } | {
                                    type: "bulletList";
                                    items: {
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    }[];
                                } | {
                                    type: "orderedList";
                                    items: {
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    }[];
                                })[] | undefined;
                                de?: ({
                                    type: "paragraph";
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                } | {
                                    type: "heading";
                                    level: 2 | 3;
                                    content: {
                                        type: "text";
                                        text: string;
                                        marks?: ({
                                            type: "bold";
                                        } | {
                                            type: "italic";
                                        } | {
                                            type: "code";
                                        } | {
                                            type: "link";
                                            href: string;
                                        })[] | undefined;
                                    }[];
                                } | {
                                    type: "bulletList";
                                    items: {
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    }[];
                                } | {
                                    type: "orderedList";
                                    items: {
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    }[];
                                })[] | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            };
                        }[];
                        heading?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                    } | {
                        id: string;
                        type: "cta";
                        label: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        };
                        style: "primary" | "secondary";
                        action: {
                            type: "openApp";
                            appId: string;
                        } | {
                            type: "requestAccess";
                            appId: string;
                        } | {
                            type: "openPage";
                            pageId: string;
                        } | {
                            type: "openUrl";
                            url: string;
                        };
                        heading?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                        text?: {
                            en?: string | undefined;
                            de?: string | undefined;
                            basis?: {
                                en?: string | undefined;
                                de?: string | undefined;
                            } | undefined;
                        } | undefined;
                    } | {
                        id: string;
                        type: "widget";
                        widgetId: string;
                        config?: Record<string, string | number | boolean | (string | number | boolean)[]> | undefined;
                    } | {
                        id: string;
                        type: "tabs";
                        tabs: {
                            id: string;
                            label: {
                                en?: string | undefined;
                                de?: string | undefined;
                                basis?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                } | undefined;
                            };
                            blocks: ({
                                id: string;
                                type: "media";
                                kind: "video" | "image";
                                mediaRef: {
                                    mediaId: string;
                                };
                                alt?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                                decorative?: true | undefined;
                                caption?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                                focal?: {
                                    x: number;
                                    y: number;
                                } | undefined;
                                posterRef?: {
                                    mediaId: string;
                                } | undefined;
                                captions?: {
                                    en?: {
                                        mediaId: string;
                                    } | undefined;
                                    de?: {
                                        mediaId: string;
                                    } | undefined;
                                } | undefined;
                            } | {
                                id: string;
                                type: "appCards";
                                heading?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                                appIds?: string[] | undefined;
                                source?: "all-visible" | undefined;
                            } | {
                                id: string;
                                type: "hero";
                                heading: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                };
                                subheading?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                                media?: {
                                    mediaId: string;
                                    alt?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    } | undefined;
                                    decorative?: true | undefined;
                                } | undefined;
                                cta?: {
                                    label: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    };
                                    style: "primary" | "secondary";
                                    action: {
                                        type: "openApp";
                                        appId: string;
                                    } | {
                                        type: "requestAccess";
                                        appId: string;
                                    } | {
                                        type: "openPage";
                                        pageId: string;
                                    } | {
                                        type: "openUrl";
                                        url: string;
                                    };
                                } | undefined;
                            } | {
                                id: string;
                                type: "richText";
                                content: {
                                    en?: ({
                                        type: "paragraph";
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    } | {
                                        type: "heading";
                                        level: 2 | 3;
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    } | {
                                        type: "bulletList";
                                        items: {
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        }[];
                                    } | {
                                        type: "orderedList";
                                        items: {
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        }[];
                                    })[] | undefined;
                                    de?: ({
                                        type: "paragraph";
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    } | {
                                        type: "heading";
                                        level: 2 | 3;
                                        content: {
                                            type: "text";
                                            text: string;
                                            marks?: ({
                                                type: "bold";
                                            } | {
                                                type: "italic";
                                            } | {
                                                type: "code";
                                            } | {
                                                type: "link";
                                                href: string;
                                            })[] | undefined;
                                        }[];
                                    } | {
                                        type: "bulletList";
                                        items: {
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        }[];
                                    } | {
                                        type: "orderedList";
                                        items: {
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        }[];
                                    })[] | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                };
                            } | {
                                id: string;
                                type: "divider";
                            } | {
                                id: string;
                                type: "gallery";
                                items: {
                                    id: string;
                                    mediaRef: {
                                        mediaId: string;
                                    };
                                    alt?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    } | undefined;
                                    decorative?: true | undefined;
                                    caption?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    } | undefined;
                                }[];
                            } | {
                                id: string;
                                type: "featureGrid";
                                items: {
                                    id: string;
                                    title: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    };
                                    text?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    } | undefined;
                                    media?: {
                                        mediaId: string;
                                        alt?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                            basis?: {
                                                en?: string | undefined;
                                                de?: string | undefined;
                                            } | undefined;
                                        } | undefined;
                                        decorative?: true | undefined;
                                    } | undefined;
                                }[];
                                heading?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                            } | {
                                id: string;
                                type: "benefits";
                                items: {
                                    id: string;
                                    title: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    };
                                    text?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    } | undefined;
                                }[];
                                heading?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                            } | {
                                id: string;
                                type: "faq";
                                items: {
                                    id: string;
                                    q: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    };
                                    a: {
                                        en?: ({
                                            type: "paragraph";
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        } | {
                                            type: "heading";
                                            level: 2 | 3;
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        } | {
                                            type: "bulletList";
                                            items: {
                                                content: {
                                                    type: "text";
                                                    text: string;
                                                    marks?: (/*elided*/ any | /*elided*/ any | /*elided*/ any | /*elided*/ any)[] | undefined;
                                                }[];
                                            }[];
                                        } | {
                                            type: "orderedList";
                                            items: {
                                                content: {
                                                    type: "text";
                                                    text: string;
                                                    marks?: (/*elided*/ any | /*elided*/ any | /*elided*/ any | /*elided*/ any)[] | undefined;
                                                }[];
                                            }[];
                                        })[] | undefined;
                                        de?: ({
                                            type: "paragraph";
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        } | {
                                            type: "heading";
                                            level: 2 | 3;
                                            content: {
                                                type: "text";
                                                text: string;
                                                marks?: ({
                                                    type: "bold";
                                                } | {
                                                    type: "italic";
                                                } | {
                                                    type: "code";
                                                } | {
                                                    type: "link";
                                                    href: string;
                                                })[] | undefined;
                                            }[];
                                        } | {
                                            type: "bulletList";
                                            items: {
                                                content: {
                                                    type: "text";
                                                    text: string;
                                                    marks?: (/*elided*/ any | /*elided*/ any | /*elided*/ any | /*elided*/ any)[] | undefined;
                                                }[];
                                            }[];
                                        } | {
                                            type: "orderedList";
                                            items: {
                                                content: {
                                                    type: "text";
                                                    text: string;
                                                    marks?: (/*elided*/ any | /*elided*/ any | /*elided*/ any | /*elided*/ any)[] | undefined;
                                                }[];
                                            }[];
                                        })[] | undefined;
                                        basis?: {
                                            en?: string | undefined;
                                            de?: string | undefined;
                                        } | undefined;
                                    };
                                }[];
                                heading?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                            } | {
                                id: string;
                                type: "cta";
                                label: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                };
                                style: "primary" | "secondary";
                                action: {
                                    type: "openApp";
                                    appId: string;
                                } | {
                                    type: "requestAccess";
                                    appId: string;
                                } | {
                                    type: "openPage";
                                    pageId: string;
                                } | {
                                    type: "openUrl";
                                    url: string;
                                };
                                heading?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                                text?: {
                                    en?: string | undefined;
                                    de?: string | undefined;
                                    basis?: {
                                        en?: string | undefined;
                                        de?: string | undefined;
                                    } | undefined;
                                } | undefined;
                            } | {
                                id: string;
                                type: "widget";
                                widgetId: string;
                                config?: Record<string, string | number | boolean | (string | number | boolean)[]> | undefined;
                            })[];
                        }[];
                    })[];
                }[];
                lock?: "none" | "content-only" | undefined;
            }[];
        };
        context: DesignerContext;
        target: OsPageTarget;
        rev: number;
        by: string | null;
    }>;
};
export type NativeSession = ReturnType<typeof createNativeSession>;
