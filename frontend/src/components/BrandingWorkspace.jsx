import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdminBranding, updateAdminBranding } from "../lib/api";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function asHex(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return HEX_PATTERN.test(trimmed) ? trimmed : "";
}

function sanitize(branding) {
  const raw = branding && typeof branding === "object" ? branding : {};
  return {
    primaryColor: asHex(raw.primaryColor) || "",
    accentColor: asHex(raw.accentColor) || "",
    logoUrl:
      typeof raw.logoUrl === "string" ? raw.logoUrl.trim() : "",
    orgDisplayName:
      typeof raw.orgDisplayName === "string"
        ? raw.orgDisplayName.trim()
        : "",
  };
}

function relativeLuminance(hex) {
  if (!HEX_PATTERN.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const channel = (v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  );
}

function contrastRatio(hex) {
  const lum = relativeLuminance(hex);
  if (lum === null) return null;
  return (1.0 + 0.05) / (lum + 0.05);
}

export default function BrandingWorkspace({ bootstrap, onSurfaceReady }) {
  const [branding, setBranding] = useState(() =>
    sanitize(bootstrap?.shell?.branding),
  );
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const shellRole = String(bootstrap?.shell?.role || "").trim();
  const isAdmin = /admin/i.test(shellRole);

  useEffect(() => {
    if (!isAdmin) {
      onSurfaceReady?.();
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetchAdminBranding()
      .then((payload) => {
        if (cancelled) return;
        setBranding(sanitize(payload?.branding));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load branding settings.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onSurfaceReady?.();
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, onSurfaceReady]);

  const handleSave = useCallback(async () => {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const response = await updateAdminBranding(branding);
      setBranding(sanitize(response?.branding));
      setSuccess(
        "Branding saved. Reload the page to see the shell palette update tenant-wide.",
      );
    } catch (err) {
      setError(err?.message || "Failed to save branding.");
    } finally {
      setSubmitting(false);
    }
  }, [branding]);

  const primaryContrast = useMemo(
    () => (branding.primaryColor ? contrastRatio(branding.primaryColor) : null),
    [branding.primaryColor],
  );
  const contrastWarning =
    primaryContrast !== null && primaryContrast < 3.0
      ? `Primary color has ${primaryContrast.toFixed(2)} contrast against white — WCAG AA requires ≥ 3.0 for non-text. Choose a darker hue.`
      : "";

  if (!isAdmin) {
    return (
      <WorkspaceStateCard
        eyebrow="Admin-only"
        title="Branding editor is admin-only"
        message="Sign in as an admin to override the default palette, logo, and org display name."
        tone="warn"
      />
    );
  }

  return (
    <section className="gh-branding-surface">
      {error ? <div className="gh-inline-alert tone-warn">{error}</div> : null}
      {success ? <div className="gh-inline-alert">{success}</div> : null}

      <section className="gh-panel gh-branding-step">
        <div className="gh-record-card-head">
          <div>
            <div className="gh-eyebrow">Tenant palette</div>
            <h2 className="gh-panel-title">Brand identity</h2>
          </div>
        </div>
        {loading ? (
          <div className="gh-support-copy">Loading current branding…</div>
        ) : null}
        <div className="gh-branding-grid">
          <label className="gh-branding-field">
            <span>Organization display name</span>
            <input
              className="gh-input"
              maxLength={80}
              onChange={(event) =>
                setBranding((current) => ({
                  ...current,
                  orgDisplayName: event.target.value,
                }))
              }
              placeholder="Governance Hub"
              type="text"
              value={branding.orgDisplayName}
            />
            <small>Shown in the shell header next to the brand glyph.</small>
          </label>

          <div className="gh-branding-field">
            <span>Primary color</span>
            <div className="gh-branding-color-row">
              <input
                aria-label="Primary color picker"
                className="gh-branding-color-picker"
                onChange={(event) =>
                  setBranding((current) => ({
                    ...current,
                    primaryColor: event.target.value,
                  }))
                }
                type="color"
                value={asHex(branding.primaryColor) || "#e11d74"}
              />
              <input
                aria-label="Primary color hex value"
                className="gh-input gh-branding-hex-input"
                maxLength={7}
                onChange={(event) =>
                  setBranding((current) => ({
                    ...current,
                    primaryColor: event.target.value,
                  }))
                }
                placeholder="#e11d74"
                value={branding.primaryColor}
              />
            </div>
            <small>6-digit hex. Overrides `--gh-accent` globally.</small>
          </div>

          <div className="gh-branding-field">
            <span>Accent color</span>
            <div className="gh-branding-color-row">
              <input
                aria-label="Accent color picker"
                className="gh-branding-color-picker"
                onChange={(event) =>
                  setBranding((current) => ({
                    ...current,
                    accentColor: event.target.value,
                  }))
                }
                type="color"
                value={asHex(branding.accentColor) || "#b81560"}
              />
              <input
                aria-label="Accent color hex value"
                className="gh-input gh-branding-hex-input"
                maxLength={7}
                onChange={(event) =>
                  setBranding((current) => ({
                    ...current,
                    accentColor: event.target.value,
                  }))
                }
                placeholder="#b81560"
                value={branding.accentColor}
              />
            </div>
            <small>Used for secondary brand accents.</small>
          </div>

          <label className="gh-branding-field gh-branding-field-wide">
            <span>Logo URL</span>
            <input
              className="gh-input"
              onChange={(event) =>
                setBranding((current) => ({
                  ...current,
                  logoUrl: event.target.value,
                }))
              }
              placeholder="https://…/logo.svg"
              type="url"
              value={branding.logoUrl}
            />
            <small>
              Public URL or a data: URI. Leave blank to keep the default mark.
            </small>
          </label>
        </div>
        {contrastWarning ? (
          <div className="gh-inline-alert tone-warn">{contrastWarning}</div>
        ) : null}
      </section>

      <section className="gh-panel gh-branding-preview">
        <div className="gh-record-card-head">
          <div>
            <div className="gh-eyebrow">Preview</div>
            <h2 className="gh-panel-title">How it will look</h2>
          </div>
        </div>
        <div
          className="gh-branding-preview-shell"
          style={{
            "--preview-primary":
              asHex(branding.primaryColor) || "var(--gh-accent)",
            "--preview-accent":
              asHex(branding.accentColor) || "var(--gh-accent-2)",
          }}
        >
          <div className="gh-branding-preview-mark">
            {branding.logoUrl ? (
              <img alt="" src={branding.logoUrl} />
            ) : (
              <span>
                {branding.orgDisplayName
                  ? branding.orgDisplayName.slice(0, 2).toUpperCase()
                  : "GH"}
              </span>
            )}
          </div>
          <div>
            <div className="gh-branding-preview-title">
              {branding.orgDisplayName || "Governance Hub"}
            </div>
            <div className="gh-branding-preview-subtitle">Metadata Workspace</div>
          </div>
          <div className="gh-branding-preview-buttons">
            <button className="gh-branding-preview-button" type="button">
              Primary action
            </button>
            <button
              className="gh-branding-preview-button gh-branding-preview-button-secondary"
              type="button"
            >
              Secondary
            </button>
          </div>
        </div>
      </section>

      <div className="gh-record-form-actions">
        <button
          className="gh-primary-button"
          disabled={submitting}
          onClick={handleSave}
          type="button"
        >
          {submitting ? "Saving…" : "Save branding"}
        </button>
      </div>
    </section>
  );
}
