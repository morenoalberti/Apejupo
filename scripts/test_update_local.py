"""Regresiones de los recursos publicados en las fichas de Info64. Sin red."""
import unittest
from unittest.mock import patch

from update_local import bases_relacionadas, detalle_info64, enlaces_ficha


class Info64InformationTests(unittest.TestCase):
    def tournament(self, slug="open"):
        return {"name": slug, "source": "Info64", "url": "https://info64.org/" + slug}

    def test_short_information_and_english_are_kept(self):
        for content in ["Inscripción abierta.", "REGISTRATION NOW OPEN<br>Information and conditions: contact the organizer."]:
            with self.subTest(content=content):
                tournament = self.tournament()
                enlaces_ficha(tournament, '<div id="collapseText"><div>' + content + '</div></div>')
                self.assertIn(content.split("<br>")[0], tournament["rules_text"])
                self.assertEqual(tournament["rules_source"], tournament["url"])
                self.assertNotIn("rules_url", tournament)

    def test_links_and_images_are_kept_without_surrounding_text(self):
        tournament = self.tournament()
        enlaces_ficha(tournament, '<div id="collapseText"><a href="/document/123">Descargar</a><img src="/poster.png" alt="Cartel"><a href="javascript:alert(1)">Ignorar</a></div>')
        self.assertEqual(tournament["rules_links"], [{"url": "https://info64.org/document/123", "label": "Descargar"}])
        self.assertEqual(tournament["rules_images"][0]["url"], "https://info64.org/poster.png")

    def test_empty_information_and_navigation_do_not_become_rules(self):
        tournament = self.tournament()
        enlaces_ficha(tournament, '<div id="collapseText"><br></div><a href="/">Información</a>')
        self.assertNotIn("rules_text", tournament)
        self.assertNotIn("rules_url", tournament)
        self.assertNotIn("rules_links", tournament)

    def test_only_explicit_festival_relations_are_shared(self):
        masters, open_event, unrelated = [self.tournament(slug) for slug in ["masters", "open", "unrelated"]]
        enlaces_ficha(masters, '<div id="collapseText">Masters conditions</div>')
        enlaces_ficha(open_event, '<div id="tournament-selection-nav"><ul><li><a href="/masters">Masters</a></li><li><a href="/open">Open</a></li></ul></div><a href="/unrelated">Another tournament</a>')
        enlaces_ficha(unrelated, '<div id="collapseText">Unrelated conditions</div>')
        bases_relacionadas([masters, open_event, unrelated])
        self.assertEqual([item["url"] for item in open_event["rules_related"]], [masters["url"]])
        self.assertEqual(open_event["rules_related"][0]["name"], "masters")
        self.assertNotIn("rules_text", open_event)
        self.assertNotIn("rules_related", unrelated)
        bases_relacionadas([masters, open_event, unrelated])
        self.assertNotIn("rules_related", open_event["rules_related"][0])

    def test_existing_pdf_rules_are_still_detected(self):
        tournament = self.tournament()
        enlaces_ficha(tournament, '<a href="/files/bases-open.pdf">Bases</a><a href="/open">Ranking inicial</a>')
        self.assertEqual(tournament["rules_url"], "https://info64.org/files/bases-open.pdf")
        self.assertEqual(tournament["participants_url"], tournament["url"])

    def test_temporarily_unavailable_source_keeps_published_rules(self):
        tournament = self.tournament()
        previous = {**tournament, "rules_text": "Published conditions", "rules_source": tournament["url"], "related_tournaments": ["https://info64.org/masters"]}
        with patch("update_local.get", side_effect=OSError("Temporary error")):
            detalle_info64(tournament, previous)
        self.assertEqual(tournament["rules_text"], "Published conditions")
        self.assertEqual(tournament["rules_source"], previous["rules_source"])
        self.assertEqual(tournament["related_tournaments"], previous["related_tournaments"])


if __name__ == "__main__":
    unittest.main()
