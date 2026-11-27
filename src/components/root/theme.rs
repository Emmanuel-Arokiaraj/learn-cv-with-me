use crate::components::dropdown_menu::{
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
};
use dioxus::prelude::*;
use dioxus_icons::lucide::{Monitor, Moon, Sun};

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

impl Theme {
    fn key(self) -> &'static str {
        match self {
            Theme::Light => "light",
            Theme::Dark => "dark",
            Theme::System => "system",
        }
    }

    fn from_key(key: &str) -> Self {
        match key {
            "light" => Theme::Light,
            "dark" => Theme::Dark,
            _ => Theme::System,
        }
    }
}

/// Applies the theme to <html>: `.dark` class (shadcn tokens) and `data-theme` (dx components).
fn apply(theme: Theme) {
    let key = theme.key();
    document::eval(&format!(
        r#"
        const t = "{key}";
        const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
        const r = document.documentElement;
        r.classList.toggle("dark", dark);
        r.setAttribute("data-theme", dark ? "dark" : "light");
        "#
    ));
}

/// Provides a `Signal<Theme>` context. Restores the saved choice on mount.
#[component]
pub fn ThemeProvider(children: Element) -> Element {
    let mut theme = use_context_provider(|| Signal::new(Theme::default()));

    // Restore saved preference (client only).
    use_effect(move || {
        spawn(async move {
            let mut eval = document::eval(r#"dioxus.send(localStorage.getItem("theme") || "system");"#);
            if let Ok(saved) = eval.recv::<String>().await {
                theme.set(Theme::from_key(&saved));
            }
        });
    });

    // Apply whenever it changes.
    use_effect(move || apply(theme()));

    // Follow OS changes while in System mode.
    use_effect(move || {
        document::eval(
            r#"
            if (!window.__themeWatch) {
                window.__themeWatch = true;
                matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
                    if ((localStorage.getItem("theme") || "system") === "system") {
                        const d = matchMedia("(prefers-color-scheme: dark)").matches;
                        document.documentElement.classList.toggle("dark", d);
                        document.documentElement.setAttribute("data-theme", d ? "dark" : "light");
                    }
                });
            }
            "#,
        );
    });

    rsx! { {children} }
}

/// Dropdown to pick Light / Dark / System. `open_up` opens the menu above the trigger (for the sidebar footer).
#[component]
pub fn ThemeSwitcher(#[props(default)] open_up: bool) -> Element {
    let mut theme = use_context::<Signal<Theme>>();

    let content_style = if open_up {
        "left:0; top:auto; bottom:100%; margin-top:0; margin-bottom:4px;"
    } else {
        "left:auto; right:0;"
    };

    let items = [
        (Theme::Light, "Light"),
        (Theme::Dark, "Dark"),
        (Theme::System, "System"),
    ];

    rsx! {
        DropdownMenu {
            DropdownMenuTrigger {
                aria_label: "Toggle theme",
                style: "display:inline-flex; align-items:center; justify-content:center; width:2.25rem; height:2.25rem; padding:0;",
                match theme() {
                    Theme::Light => rsx! { Sun { size: "16px" } },
                    Theme::Dark => rsx! { Moon { size: "16px" } },
                    Theme::System => rsx! { Monitor { size: "16px" } },
                }
            }
            DropdownMenuContent { style: content_style,
                for (index, (value, label)) in items.into_iter().enumerate() {
                    DropdownMenuItem::<Theme> {
                        value,
                        index,
                        on_select: move |v: Theme| {
                            theme.set(v);
                            document::eval(&format!(r#"localStorage.setItem("theme", "{}");"#, v.key()));
                        },
                        match value {
                            Theme::Light => rsx! { Sun { size: "16px" } },
                            Theme::Dark => rsx! { Moon { size: "16px" } },
                            Theme::System => rsx! { Monitor { size: "16px" } },
                        }
                        span { "{label}" }
                    }
                }
            }
        }
    }
}
