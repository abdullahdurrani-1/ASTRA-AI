import { useState } from "react";
import { AstraIntro, shouldShowIntro } from "./components/AstraIntro";
import { HomePage } from "./pages/HomePage";

export function App() {
  // The app mounts underneath the intro, so documents and health load while it plays.
  const [intro, setIntro] = useState(() => shouldShowIntro());
  return (
    <>
      {/* inert keeps keyboard focus and screen readers out of the page while the intro plays. */}
      <div inert={intro || undefined} className="h-full">
        <HomePage />
      </div>
      {intro && <AstraIntro onDone={() => setIntro(false)} />}
    </>
  );
}
