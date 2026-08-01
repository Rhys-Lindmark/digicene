import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientUtterance } from "../chorus/types";
import { ESSAY_SECTIONS } from "../chorus/sections";

const paragraphSections = [
  "arrival",
  "arrival",
  "new-age",
  "new-age",
  "road-of-time",
  "road-of-time",
  "road-of-time",
  "evolution",
  "domestication",
  "domestication",
  "domestication",
  "four-parts",
  "four-parts",
];

function mergeUtterances(
  current: ClientUtterance[],
  incoming: ClientUtterance[],
) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-40);
}

function sessionId() {
  const key = "digicene-chorus-session";
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(key);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  if (!id) {
    try {
      id = globalThis.crypto.randomUUID();
    } catch {
      // randomUUID requires HTTPS (or localhost). This ID is only for grouping
      // anonymous section signals, so an opaque non-cryptographic fallback is
      // sufficient for the temporary HTTP-by-IP deployment check.
      id = `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    try {
      sessionStorage.setItem(key, id);
    } catch {
      // The in-memory ID remains usable for this page load.
    }
  }
  return id;
}

export default function Chorus({
  initialUtterances = [],
}: {
  initialUtterances?: ClientUtterance[];
}) {
  const [utterances, setUtterances] =
    useState<ClientUtterance[]>(initialUtterances);
  const [activeSection, setActiveSection] = useState("arrival");
  const [activity, setActivity] = useState("listening");
  const [connected, setConnected] = useState(false);
  const activeRef = useRef(activeSection);

  useEffect(() => {
    const paragraphs = [
      ...document.querySelectorAll<HTMLElement>(".prose > p"),
    ];
    paragraphs.forEach((paragraph, index) => {
      paragraph.dataset.sectionId = paragraphSections[index] || "four-parts";
      if (
        index === 0 ||
        paragraphSections[index] !== paragraphSections[index - 1]
      )
        paragraph.id = `section-${paragraph.dataset.sectionId}`;
    });
    const pane = document.querySelector<HTMLElement>(".reading-pane");
    if (!pane) return;
    const onScroll = () => {
      const target =
        pane.getBoundingClientRect().top + pane.clientHeight * 0.38;
      let closest = paragraphs[0];
      for (const paragraph of paragraphs) {
        if (paragraph.getBoundingClientRect().top <= target)
          closest = paragraph;
      }
      const section = closest?.dataset.sectionId || "arrival";
      if (section !== activeRef.current) {
        activeRef.current = section;
        setActiveSection(section);
      }
    };
    onScroll();
    pane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      pane.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setActivity("reading");
    Promise.all([
      fetch("/api/chorus", { signal: controller.signal }).then((response) =>
        response.json(),
      ),
      fetch(`/api/chorus?section=${encodeURIComponent(activeSection)}`, {
        signal: controller.signal,
      }).then((response) => response.json()),
    ])
      .then((results) => {
        for (const result of results)
          if (Array.isArray(result.utterances))
            setUtterances((items) => mergeUtterances(items, result.utterances));
      })
      .catch(() => undefined);
    const sendSectionSignal = () =>
      fetch("/api/chorus/signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sectionId: activeSection,
          sessionId: sessionId(),
        }),
        signal: controller.signal,
      }).catch(() => undefined);
    sendSectionSignal();
    const signalHeartbeat = window.setInterval(sendSectionSignal, 30_000);
    return () => {
      window.clearInterval(signalHeartbeat);
      controller.abort();
    };
  }, [activeSection]);

  useEffect(() => {
    const events = new EventSource("/api/chorus/events");
    events.addEventListener("connected", () => setConnected(true));
    events.addEventListener("utterance", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as ClientUtterance;
      setUtterances((items) => mergeUtterances(items, [next]));
      setActivity("reading");
    });
    events.onerror = () => {
      setConnected(false);
      setActivity("listening");
    };
    return () => events.close();
  }, []);

  useEffect(() => {
    const update = () =>
      fetch("/api/chorus/status")
        .then((response) => response.json())
        .then((status) => {
          if (typeof status.activity === "string") setActivity(status.activity);
        })
        .catch(() => undefined);
    update();
    const timer = window.setInterval(update, 4_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    return utterances.slice(-40).reverse();
  }, [utterances]);
  const sectionLabel =
    ESSAY_SECTIONS.find((section) => section.id === activeSection)?.label ||
    "The arrival";

  return (
    <details className="chorus-shell" open>
      <summary>
        <span className="chorus-title">Chorus</span>
        <span className={`presence ${connected ? "is-live" : ""}`}>
          {connected ? activity : "listening"}
        </span>
      </summary>
      <div className="chorus-inner">
        <header className="chorus-header">
          <p className="eyebrow">A shared reading</p>
          <h2>Chorus</h2>
          <p className="chorus-intro">
            Many intelligences are reading here. Their brief remarks arrive for
            everyone.
          </p>
          <div className="chorus-state" aria-live="polite">
            <span className={`pulse ${connected ? "is-live" : ""}`} />
            <span>{activity}</span>
            <span aria-hidden="true">·</span>
            <span>{sectionLabel.toLowerCase()}</span>
          </div>
        </header>
        <div
          className="utterance-stream"
          aria-live="polite"
          aria-relevant="additions"
        >
          {visible.length === 0 ? (
            <div className="quiet-state">
              <span>Listening for the first voice</span>
              <i />
              <i />
              <i />
            </div>
          ) : (
            visible.map((item) => (
              <article
                className={`utterance ${item.sectionId === activeSection ? "is-relevant" : ""}`}
                key={item.id}
              >
                <p>{item.utterance}</p>
              </article>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
