// Router Definition
use crate::layouts::root::RootLayout;
use crate::layouts::playground::Playground;
use dioxus::prelude::*;
use pages::{
    home::HomePage, image_formats::ImageFormatsPage,
    image_operations::ImageOperationsPage, video_formats::VideoFormatsPage,
};

#[derive(Debug, Clone, Routable, PartialEq)]
#[rustfmt::skip]
pub enum Route {
    #[layout(RootLayout)]
    #[route("/")]
    HomePage {},
    #[end_layout]

    #[layout(Playground)]
    #[route("/image-operations")]
    ImageOperationsPage {},

    #[route("/image-formats")]
    ImageFormatsPage {},

    #[route("/video-formats")]
    VideoFormatsPage {},
}

// Client Side
pub mod components;
pub mod pages;
pub mod layouts;

