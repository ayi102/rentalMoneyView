import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. This is what makes "Add to Home Screen" give a
// standalone app rather than a browser tab.
//
// Deliberately no service worker: an offline cache would put this property's
// financial history in on-device storage, which cuts against keeping it behind a
// login. The app is online-only by design.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "rentalMoneyView",
    short_name: "rentalMoney",
    description: "The economic outlook for your rental property.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f6f7f9",
    theme_color: "#1f6feb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
