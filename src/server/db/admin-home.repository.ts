// Home banners and section editor persistence in D1. Server-only.
import type { AdminIdentity } from "@/domain/admin";
import {
  DEFAULT_HOME_SETTINGS,
  type HomeBanner,
  type HomeSectionConfig,
  type HomeSettings,
  type PhilosophyConfig,
} from "@/domain/home-settings";
import { auditStatement } from "@/server/admin/auth.server";
import type { D1Database, D1PreparedStatement } from "./d1";

interface BannerRow {
  id: number;
  desktop_image: string;
  mobile_image: string;
  heading: string;
  button_text: string;
  link_href: string;
  active: number;
  sort: number;
}

interface SettingsRow {
  sections_json: string;
  philosophy_json: string;
}

export async function readHomeSettings(db: D1Database): Promise<HomeSettings> {
  const [bannerResult, settingsResult] = await db.batch([
    db.prepare(
      "SELECT id, desktop_image, mobile_image, heading, button_text, link_href, active, sort FROM home_banners ORDER BY sort, id",
    ),
    db.prepare("SELECT sections_json, philosophy_json FROM home_settings WHERE id = 1"),
  ]);

  const banners: HomeBanner[] = ((bannerResult?.results ?? []) as BannerRow[]).map((row) => ({
    id: row.id,
    desktopImage: row.desktop_image,
    mobileImage: row.mobile_image,
    heading: row.heading,
    buttonText: row.button_text,
    linkHref: row.link_href,
    active: row.active === 1,
    sort: row.sort,
  }));

  const row = (settingsResult?.results ?? [])[0] as SettingsRow | undefined;
  let sections: HomeSectionConfig[] = DEFAULT_HOME_SETTINGS.sections;
  let philosophy: PhilosophyConfig = DEFAULT_HOME_SETTINGS.philosophy;
  if (row) {
    try {
      const parsedSections = JSON.parse(row.sections_json) as HomeSectionConfig[];
      if (Array.isArray(parsedSections) && parsedSections.length > 0) sections = parsedSections;
    } catch {
      // fall back to default sections
    }
    try {
      const parsedPhilosophy = JSON.parse(row.philosophy_json) as PhilosophyConfig;
      if (parsedPhilosophy && typeof parsedPhilosophy === "object") {
        philosophy = { ...DEFAULT_HOME_SETTINGS.philosophy, ...parsedPhilosophy };
      }
    } catch {
      // fall back to default philosophy
    }
  }

  return { banners, sections, philosophy };
}

export async function saveHomeSettings(
  db: D1Database,
  actor: AdminIdentity,
  input: HomeSettings,
  now = new Date(),
): Promise<{ ok: true; settings: HomeSettings }> {
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM home_banners"),
    ...input.banners.map((banner, index) =>
      db
        .prepare(
          `INSERT INTO home_banners (desktop_image, mobile_image, heading, button_text, link_href, active, sort, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          banner.desktopImage,
          banner.mobileImage || banner.desktopImage,
          banner.heading,
          banner.buttonText,
          banner.linkHref || "/products",
          banner.active ? 1 : 0,
          index,
          at,
        ),
    ),
    db
      .prepare(
        `INSERT INTO home_settings (id, sections_json, philosophy_json, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET sections_json = excluded.sections_json,
           philosophy_json = excluded.philosophy_json, updated_at = excluded.updated_at`,
      )
      .bind(JSON.stringify(input.sections), JSON.stringify(input.philosophy), at),
    auditStatement(
      db,
      actor,
      "home.updated",
      "home_settings",
      { banners: input.banners.length, visibleSections: input.sections.filter((s) => s.visible).length },
      now,
    ),
  ];
  await db.batch(statements);
  return { ok: true, settings: await readHomeSettings(db) };
}
