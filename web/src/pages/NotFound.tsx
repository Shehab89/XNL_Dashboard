import { Link } from "react-router-dom";
import { useLang } from "../hooks/useLang";
import { useTitle } from "../hooks/useTitle";

export default function NotFound() {
  const { t } = useLang();
  useTitle(t("Niet gevonden", "Not found"));
  return (
    <div className="page" style={{ padding: "72px var(--gutter)" }}>
      <div className="kicker"><span className="num">404</span></div>
      <h1 className="display h1" style={{ marginTop: 12 }}>{t("Deze pagina bestaat niet.", "This page does not exist.")}</h1>
      <p className="lede" style={{ marginTop: 12 }}>{t("Misschien is de naam veranderd. Zoeken helpt meestal.", "The name may have changed. Searching usually helps.")}</p>
      <div className="row" style={{ marginTop: 24 }}>
        <Link className="btn btn-primary" to="/zoeken">{t("Zoeken", "Search")}</Link>
        <Link className="btn" to="/">{t("Naar het overzicht", "Go to overview")}</Link>
      </div>
    </div>
  );
}
