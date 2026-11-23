import { CHANNEL_KIND_LABELS, CONTACT_SOURCE_LABELS, type ContactChannel } from "@/lib/cnpj/contact-info";

function href(c: ContactChannel): string | null {
  const d = c.value.replace(/\D/g, "");
  if (c.kind === "email") return `mailto:${c.value}`;
  if (c.kind === "phone" && d.length >= 10) return `tel:+55${d.slice(-11)}`;
  if (c.kind === "whatsapp" && d.length >= 10) return `https://wa.me/55${d.slice(-11)}`;
  return null;
}

/** Site e canais de contato com a origem de cada um. */
export function ContactInfoView({ website, websiteSource, channels }: { website: string | null; websiteSource: string | null; channels: ContactChannel[] }) {
  if (!website && channels.length === 0) return <p className="text-sm text-neutral-500">Ainda sem site ou canais de contato.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {website && (
        <li>
          <span className="text-neutral-500">Site: </span>
          <a href={website} target="_blank" rel="noopener noreferrer" className="underline">
            {website}
          </a>
          {websiteSource === "manual" && <span className="text-xs text-neutral-500"> · {CONTACT_SOURCE_LABELS.manual}</span>}
        </li>
      )}
      {channels.map((c, i) => {
        const link = href(c);
        return (
          <li key={i}>
            <span className="text-neutral-500">
              {CHANNEL_KIND_LABELS[c.kind]}
              {c.label ? ` · ${c.label}` : ""}:{" "}
            </span>
            {link ? (
              <a href={link} className="underline" {...(c.kind === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {c.value}
              </a>
            ) : (
              c.value
            )}
            <span className="text-xs text-neutral-500"> · {CONTACT_SOURCE_LABELS[c.source]}</span>
          </li>
        );
      })}
    </ul>
  );
}
