use crate::components::root::app_sidebar::AppSidebar;
use crate::components::separator::Separator;
use crate::components::sidebar::{
    SidebarInset, SidebarProvider, SidebarTrigger,
};
use crate::Route;
use dioxus::prelude::*;

#[component]
pub fn Playground() -> Element {
    rsx! {
        SidebarProvider {
            AppSidebar {}
            SidebarInset {
                header {
                    style: "display:flex; align-items:center; justify-content:space-between; height:3.5rem; flex-shrink:0; padding:0 1rem; border-bottom:1px solid var(--dx-sidebar-border); background:var(--primary-color-1);",
                    div {
                        style: "display:flex; align-items:center; gap:0.75rem;",
                        SidebarTrigger {}
                        Separator { height: "1rem", horizontal: false }
                        span { "Playground" }
                    }
                }
                div {
                    style: "display:flex; flex:1; flex-direction:column; min-height:0; overflow-y:auto; overflow-x:hidden;",
                    Outlet::<Route> {}
                }
            }
        }
    }
}
