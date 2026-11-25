import { redirect } from "next/navigation";

/** Comments moved into Admin → Messenger; notifications sent before still link here. */
export default function CommentsPage() {
    redirect("/admin/customers/inbox?tab=comments");
}
