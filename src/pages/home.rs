use crate::components::button::{Button, ButtonSize, ButtonVariant};
use crate::Route;
use dioxus::prelude::*;

#[component]
pub fn HomePage() -> Element {
    let navigator = use_navigator();

    rsx! {
        section {
            id: "home_page",
            class: "mx-auto flex min-h-[50vh] w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center",
            p {
                class: "text-xs font-medium uppercase tracking-widest text-muted-foreground",
                "Computer vision, hands on"
            }
            h1 {
                class: "font-serif text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-6xl",
                "See how images and video really work."
            }
            p {
                class: "max-w-xl text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg",
                "Upload a file, apply an operation, and compare the result side by side. No setup, no theory wall."
            }
            div {
                class: "mt-2 flex items-center gap-3",
                Button {
                    variant: ButtonVariant::Primary,
                    size: ButtonSize::Lg,
                    onclick: move |_| { navigator.push(Route::ImageOperationsPage {}); },
                    "Open the playground"
                }
            }
        }
    }
}
