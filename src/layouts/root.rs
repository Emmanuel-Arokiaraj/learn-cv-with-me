use dioxus::prelude::*;

use crate::components::root::{footer::footer_component, navbar::navbar_component};
use crate::Route;

/// Marketing layout: 10vh navbar, flexible content, 40vh footer.
#[component]
pub fn RootLayout() -> Element {
    rsx! {
        div {
            class: "flex min-h-screen flex-col bg-background text-foreground",
            {navbar_component()}
            main { class: "flex flex-1 flex-col", Outlet::<Route> {} }
            {footer_component()}
        }
    }
}
