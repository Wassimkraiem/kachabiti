/** A schema.org JSON-LD block in the server HTML (lib/structured-data.ts). `<` is escaped so text from the catalog can't close the script. */
export default function JsonLd({ data }: { data: object }) {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
