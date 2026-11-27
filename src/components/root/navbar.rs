use crate::components::button::{Button, ButtonSize, ButtonVariant};
use crate::components::root::theme::ThemeSwitcher;
use crate::Route;
use dioxus::prelude::*;

/// Top navigation bar. Fixed at 10vh.
#[component]
pub fn navbar_component() -> Element {
    let navigator = use_navigator();

    rsx! {
        header {
            id: "navbar",
            class: "h-[10vh] shrink-0 border-b border-border bg-background/80 backdrop-blur",
            nav {
                class: "mx-auto flex h-full w-full max-w-6xl items-center justify-between px-6",
                Link {
                    to: Route::HomePage {},
                    class: "flex items-center gap-2 font-serif text-lg font-semibold tracking-tight text-foreground",
                    img {
                        src: asset!("/assets/images/logo.png"),
                        alt: "Learn CV with Me logo",
                        class: "h-8 w-8 object-contain",
                    }
                    span { "learn-cv-with-me" }
                }
                div {
                    class: "flex items-center gap-2",
                    Button {
                        variant: ButtonVariant::Primary,
                        size: ButtonSize::Sm,
                        onclick: move |_| { navigator.push(Route::ImageOperationsPage {}); },
                        "Playground"
                    }
                    ThemeSwitcher {}
                }
            }
        }
    }
}
