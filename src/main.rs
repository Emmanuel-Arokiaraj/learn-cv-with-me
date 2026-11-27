use dioxus::prelude::*;


/**
 * Stylesheets and Assets for the Web Server.
 */
const FAVICON: Asset = asset!("/assets/icons/favicon.ico");
const THEME_CSS: Asset = asset!("/assets/styles/dx-components-theme.css");
const IMAGE_LAB_CSS: Asset = asset!("/assets/styles/image_lab.css");
// const HEADER_SVG: Asset = asset!("/assets/images/header.svg");
const TAILWIND_CSS: Asset = asset!("/assets/styles/tailwind.css");

use learn_cv_with_me::components::root::theme::ThemeProvider;
use learn_cv_with_me::Route;

const THEME_INIT_JS: &str = r#"(function(){try{var t=localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.setAttribute("data-theme",d?"dark":"light");}catch(e){}})();"#;

/**
 * Main Runner
 */
fn main() {
    dioxus::launch(App);
}

/**
 * App Widget
 */
#[component]
fn App() -> Element {
    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "stylesheet", href: THEME_CSS }
        document::Link { rel: "stylesheet", href: TAILWIND_CSS }
        document::Stylesheet { href: IMAGE_LAB_CSS }
        // Apply saved theme before first paint to avoid a flash.
        document::Script { {THEME_INIT_JS} }
        ThemeProvider {
            Router::<Route> {}
        }
    }
}
