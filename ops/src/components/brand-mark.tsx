import markSvg from "@/assets/logo/mono.svg?raw";

/**
 * The one-colour mark (branding/logo/mono.svg, unchanged). It is inlined so its
 * currentColor takes the text colour of the place it sits in, in either scheme.
 */
const markupOfMark = markSvg.replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%"');

export function BrandMark({ className }: { className?: string }) {
  return <span className={className} style={{ display: "inline-block" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markupOfMark }} />;
}
