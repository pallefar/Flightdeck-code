import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioDesignerApp } from "./studio/StudioDesignerApp";

const host = document.getElementById("root");
if (host === null) throw new Error("no #root");
createRoot(host).render(<StrictMode><StudioDesignerApp initialAppearance="night" /></StrictMode>);
