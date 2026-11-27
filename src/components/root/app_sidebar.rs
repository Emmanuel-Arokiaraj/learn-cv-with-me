use crate::components::sidebar::{
    Sidebar, SidebarCollapsible, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
    SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarSide, SidebarVariant,
};
use crate::components::root::theme::ThemeSwitcher;
use crate::Route;
use dioxus::prelude::*;

#[component]
pub fn AppSidebar() -> Element {
    let active_route = use_route::<Route>();

    rsx! {
        Sidebar {
            variant: SidebarVariant::Sidebar,
            collapsible: SidebarCollapsible::Offcanvas,
            side: SidebarSide::Left,
            SidebarHeader {
                SidebarMenu {
                    SidebarMenuItem {
                        SidebarMenuButton {
                            size: crate::components::sidebar::SidebarMenuButtonSize::Lg,
                            is_active: active_route == (Route::HomePage {}),
                            as: move |attributes: Vec<Attribute>| rsx! {
                                Link { to: Route::HomePage {}, attributes: attributes,
                                    img {
                                        src: asset!("/assets/images/logo.png"),
                                        alt: "Learn CV with Me logo",
                                        style: "width:1.5rem; height:1.5rem; object-fit:contain;",
                                    }
                                    span { "CV Image Studio" }
                                }
                            },
                        }
                    }
                }
            }
            SidebarContent {
                SidebarGroup {
                    SidebarGroupLabel { "1. Fundamentals" }
                    SidebarMenu {
                        SidebarMenuItem {
                            SidebarMenuButton {
                                is_active: active_route == (Route::ImageOperationsPage {}),
                                as: move |attributes: Vec<Attribute>| rsx! {
                                    Link { to: Route::ImageOperationsPage {}, attributes: attributes,
                                        span { "Image Operations" }
                                    }
                                },
                            }
                        }
                        SidebarMenuItem {
                            SidebarMenuButton {
                                is_active: active_route == (Route::ImageFormatsPage {}),
                                as: move |attributes: Vec<Attribute>| rsx! {
                                    Link { to: Route::ImageFormatsPage {}, attributes: attributes,
                                        span { "Image Formats" }
                                    }
                                },
                            }
                        }
                        SidebarMenuItem {
                            SidebarMenuButton {
                                is_active: active_route == (Route::VideoFormatsPage {}),
                                as: move |attributes: Vec<Attribute>| rsx! {
                                    Link { to: Route::VideoFormatsPage {}, attributes: attributes,
                                        span { "Video Formats" }
                                    }
                                },
                            }
                        }
                    }
                }
            }
            SidebarFooter {
                ThemeSwitcher { open_up: true }
            }
            SidebarRail {}
        }
    }
}
