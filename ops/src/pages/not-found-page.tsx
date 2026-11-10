import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Nie ma takiego widoku</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Adres nie prowadzi do żadnego obszaru panelu OPs.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            <ArrowLeft aria-hidden="true" />
            Wróć do przeglądu
          </Link>
        </Button>
      </div>
    </div>
  );
}
