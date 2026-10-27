import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./studio/StudioApp";

const host = document.getElementById("root");
if (host === null) throw new Error("no #root");
createRoot(host).render(<StrictMode><StudioApp initialAppearance="night" /></StrictMode>);
