"""Request construction only. No synthetic model responses or classifications."""
import json
import unittest

from benchmark_ownership import request_for
from ownership_plans import build_plan_request, split_plan_request


class OwnershipRequestTests(unittest.TestCase):
    def setUp(self):
        self.sample = {
            "name": "SECRET_CASE_LABEL", "expected_roots": ["SECRET_EXPECTED_ROOT"],
            "anchor_id": "n2", "atoms": ["n3"],
            "observation": {"root": "n1", "nodes": [
                {"id": "n1", "parent": None, "kind": "element", "tag": "article"},
                {"id": "n2", "parent": "n1", "kind": "element", "tag": "p"},
                {"id": "n3", "parent": "n2", "kind": "text", "text": "Tickets for sale."},
            ]},
            "plans": [{"id": "none", "atoms": []}, {"id": "scope_1", "atoms": ["n3"]}],
            "candidate": {"text": "Tickets for sale.", "links": [], "ad": {
                "tag": "p", "tokens": "", "label": "", "source_host": "", "known_host": False,
            }},
        }
        self.base = request_for(self.sample, False)

    def test_scope_classification_uses_anchor_context_without_changing_base(self):
        base = self.base
        before = json.dumps(base, sort_keys=True)
        payload = build_plan_request(base, self.sample)
        for name in ("ad_0", "unsafe_0"):
            instructions = payload["questions"][name]["instructions"]
            self.assertIn("`page`", instructions)
            self.assertIn("`anchor_id`", instructions)
        self.assertNotIn("SECRET_", json.dumps(payload))
        self.assertEqual(json.dumps(base, sort_keys=True), before)
        self.assertEqual(payload["state"]["anchor"]["children"][0]["text"], "Tickets for sale.")

    def test_speculative_classification_names_each_scope_directly(self):
        scoped = build_plan_request(self.base, self.sample, classify_scopes=True)
        for category in ("ad", "unsafe"):
            question = scoped["questions"][f"{category}_scope_1"]
            self.assertIn("`scopes.scope_1.includes`", question["instructions"])
            self.assertNotIn(f"{category}_none", scoped["questions"])

    def test_parallel_grouping_request_excludes_moderation_policy(self):
        scoped = build_plan_request(self.base, self.sample, classify_scopes=True)
        grouping, classification = split_plan_request(scoped)
        self.assertNotIn("policy", grouping["state"])
        self.assertNotIn("candidates", grouping["state"])
        self.assertIn("removal_scope", grouping["questions"])
        self.assertNotIn("removal_scope", classification["questions"])
        self.assertFalse(set(grouping["questions"]) & set(classification["questions"]))
        self.assertEqual(set(grouping["questions"]) | set(classification["questions"]), set(scoped["questions"]))

    def test_relation_questions_use_explicit_part_references(self):
        relational = build_plan_request(self.base, self.sample, classify_scopes=True, include_relations=True)
        relation = relational["questions"]["relation_n3"]
        self.assertEqual(relation["type"], "choice")
        self.assertIn("`parts.n3`", relation["instructions"])
        self.assertEqual(set(relation["criteria"]), {"same_item", "other_item", "shared_interface", "unknown"})
        grouping, classification = split_plan_request(relational)
        self.assertIn("relation_n3", grouping["questions"])
        self.assertNotIn("relation_n3", classification["questions"])
        self.assertNotIn("SECRET_", json.dumps(relational))

    def test_labels_cannot_leak_into_provider_state(self):
        sample = {
            "name": "SECRET_CASE_LABEL", "expected_roots": ["SECRET_EXPECTED_ROOT"],
            "candidate": {"text": "Tickets for sale.", "links": [], "ad": {
                "tag": "p", "tokens": "", "label": "", "source_host": "", "known_host": False,
            }},
            "anchor_id": "n4", "atoms": ["n5", "n6"],
            "observation": {"root": "n1", "nodes": [], "incomplete": []},
        }
        payload = request_for(sample, True)
        self.assertNotIn("SECRET_", json.dumps(payload))
        self.assertEqual(set(payload["questions"]), {"ad_0", "unsafe_0", "owns_n5", "owns_n6"})
        baseline = request_for(sample, False)
        self.assertEqual(set(baseline["questions"]), {"ad_0", "unsafe_0"})
        self.assertNotIn("observation", baseline["state"])


if __name__ == "__main__":
    unittest.main()
