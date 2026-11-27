use crate::Route;
use dioxus::prelude::*;

/// Site footer. Fixed at 40vh.
#[component]
pub fn footer_component() -> Element {
    rsx! {
        footer {
            id: "footer",
            class: "h-[40vh] shrink-0 border-t border-border bg-secondary text-secondary-foreground",
            div {
                class: "mx-auto flex h-full w-full max-w-6xl flex-col justify-between px-6 py-12",
                div {
                    class: "grid gap-10 md:grid-cols-[2fr_1fr_1fr]",
                    div {
                        class: "max-w-sm space-y-3",
                        p { class: "font-serif text-xl font-semibold tracking-tight", "learn-cv-with-me" }
                        p {
                            class: "text-sm leading-relaxed text-muted-foreground",
                            "A hands-on playground for learning image and video processing, one operation at a time."
                        }
                    }
                    div {
                        class: "space-y-3",
                        p { class: "text-xs font-medium uppercase tracking-widest text-muted-foreground", "Playground" }
                        ul {
                            class: "space-y-2 text-sm",
                            li { Link { to: Route::ImageOperationsPage {}, class: "hover:underline", "Image operations" } }
                            li { Link { to: Route::ImageFormatsPage {}, class: "hover:underline", "Image formats" } }
                            li { Link { to: Route::VideoFormatsPage {}, class: "hover:underline", "Video formats" } }
                        }
                    }
                    div {
                        class: "space-y-3",
                        p { class: "text-xs font-medium uppercase tracking-widest text-muted-foreground", "Project" }
                        ul {
                            class: "space-y-2 text-sm",
                            li { Link { to: Route::HomePage {}, class: "hover:underline", "Home" } }
                        }
                    }
                }
                p {
                    class: "border-t border-border pt-6 text-xs text-muted-foreground",
                    "Built with Rust and Dioxus."
                }
            }
        }
    }
}
