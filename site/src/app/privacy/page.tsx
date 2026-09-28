import Link from "next/link";
import type { ReactNode } from "react";
import { Footer, Header } from "@/components/Chrome";
import { Reveal } from "@/components/Reveal";
import { pageMetadata } from "@/lib/metadata";
import { AUTHOR, REPO } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Privacy",
  description:
    "What cue.wicker.life measures (cookieless, in the EU, no personal data) and the anonymous usage report the Cue app sends only if you turn it on.",
  path: "/privacy",
});

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Reveal as="section" y={28} className="rounded-2xl bg-card p-6 sm:p-7" id={id}>
      <h2 className="text-[24px] font-bold tracking-[-0.025em]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-white/85">{children}</div>
    </Reveal>
  );
}

const code = "rounded bg-white/10 px-1.5 font-mono text-[13px]";

/** The app's events, as sent by electron/core/usage.ts (keep in step with its allowlist). */
const APP_EVENTS: { name: string; what: string }[] = [
  { name: "app_opened", what: "Cue's version, the operating system (macOS, Windows or Linux), the processor type (arm64 or x64) and the interface language (for example “en”). Once per launch." },
  { name: "project_created", what: "That a project was created. Nothing about it." },
  { name: "export_finished", what: "The kind of export (video, audio, GIF, captions, …), roughly how long the exported part is (for example “2-10 min”), and whether it succeeded." },
  { name: "agent_chat_turn", what: "Which agent answered in Cue's agent panel (Claude Code, Codex or Gemini CLI)." },
  { name: "mcp_request_batch", what: "Which of Cue's MCP tools agents called and how many times, added up and sent at most every few minutes." },
  { name: "generation_used", what: "What was generated (voice, sound, music, clip, image or transcription) and by which service (for example OpenAI, ElevenLabs, fal, or Cue itself)." },
  { name: "motion_timeline_used", what: "That the motion graphics timeline was used. Once per launch." },
  { name: "update_installed", what: "The version Cue was updated from and to." },
];

export default function Privacy() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-[760px] px-5 pt-14 pb-28">
        <Reveal as="h1" className="text-[40px] leading-[1.05] font-bold tracking-[-0.035em] sm:text-[52px]">
          Privacy
        </Reveal>
        <Reveal delay={150} as="p" className="mt-4 text-[17px] leading-relaxed text-muted">
          Cue is open source and your projects stay on your computer. This page says exactly what this website measures and what the
          Cue app can send, which it does only if you say yes.
        </Reveal>

        <div className="mt-12 flex flex-col gap-4">
          <Section id="website" title="This website">
            <p>
              cue.wicker.life counts visits with{" "}
              <a href="https://posthog.com" className="underline underline-offset-4 hover:text-white">
                PostHog
              </a>
              , hosted in the EU (Frankfurt), through this site&apos;s own address. It measures which pages are viewed, which links and
              buttons are clicked (for example which download), when a command or prompt is copied, and the referring site.
            </p>
            <p>
              It sets <strong className="text-white">no cookies</strong> and stores nothing in your browser (no local or session storage).
              To count visitors, PostHog computes an anonymous hash on its servers from your IP address, browser and this site, with a
              random value that changes every day and is then deleted. So the same visitor can&apos;t be recognised from one day to the
              next, and your IP address is not stored with the events.
            </p>
            <p>
              There are no personal profiles, no session recordings, no advertising and no tracking across other websites. If your
              browser sends Do Not Track, nothing is sent at all.
            </p>
          </Section>

          <Section id="app" title="The Cue app">
            <p>
              The app sends nothing about how you use it unless you choose <strong className="text-white">Share anonymous usage</strong>{" "}
              (Cue asks once, and the setting is in Settings → General). If you do, it sends these events to the same EU PostHog project,
              with a random install ID created on your computer (not linked to you, your account or your device):
            </p>
            <ul className="flex flex-col gap-2">
              {APP_EVENTS.map((e) => (
                <li key={e.name} className="rounded-xl bg-white/[0.04] px-4 py-3">
                  <code className={code}>{e.name}</code>
                  <span className="mt-1 block text-[14px] text-muted">{e.what}</span>
                </li>
              ))}
            </ul>
            <p>
              Cue asks PostHog not to look up a location from your IP address and not to build a profile of you. Development builds of
              Cue never send anything. Checking for updates talks to GitHub, not to PostHog, and happens whether or not you share usage
              (you can turn it off in Settings → General → Updates).
            </p>
          </Section>

          <Section id="never" title="Never sent">
            <p>
              Neither the site nor the app ever sends file or project names, folder paths, your media, transcripts, scripts or any other
              project content, what you type to an agent (prompts), generated text or pictures, or API keys. The app checks every event
              against a fixed list of allowed properties before sending it; anything else is dropped. You can read that list in{" "}
              <a href={`${REPO}/blob/main/electron/core/usage.ts`} className="underline underline-offset-4 hover:text-white">
                electron/core/usage.ts
              </a>
              .
            </p>
            <p>
              Services you connect yourself (OpenAI, ElevenLabs, fal, Higgsfield) receive what you ask them to generate, directly from
              your computer, under their own privacy policies. Cue doesn&apos;t see or keep a copy.
            </p>
          </Section>

          <Section id="off" title="Turning it off">
            <p>
              In the app: Settings → General → <strong className="text-white">Share anonymous usage</strong>. Turning it off stops sending
              straight away, including anything not yet sent. To also forget the install ID, delete the file{" "}
              <code className={code}>usage.json</code> in Cue&apos;s data folder.
            </p>
            <p>
              On this website: turn on Do Not Track in your browser, or use a content blocker. The site works the same either way.
            </p>
          </Section>

          <Section id="contact" title="Questions">
            <p>
              Open an issue on{" "}
              <a href={`${REPO}/issues`} className="underline underline-offset-4 hover:text-white">
                GitHub
              </a>{" "}
              or get in touch through{" "}
              <a href={AUTHOR.url} className="underline underline-offset-4 hover:text-white">
                wicker.life
              </a>
              . Cue is made by {AUTHOR.name}. See also the{" "}
              <Link href="/download" className="underline underline-offset-4 hover:text-white">
                downloads
              </Link>{" "}
              and the{" "}
              <a href={REPO} className="underline underline-offset-4 hover:text-white">
                source code
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
      <Footer />
    </>
  );
}
