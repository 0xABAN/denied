"""Real TCP/FastAPI/provider checks. Run with uv run --env-file .env python -m unittest discover -s tests."""

from contextlib import contextmanager
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from tempfile import NamedTemporaryFile

import httpx
from pydantic import ValidationError

from denied.judge import ADDRESS_CONTEXT, build_request
from denied.schemas import Batch, Noul

BATCH = {
    "document_id": "real-api-test", "page_host": "controlled-example.test", "page_scheme": "http",
    "candidates": [{
        "id": "1:0", "revision": 1, "text": "Sponsored. Buy our new colored pencil collection today.", "links": [],
        "ad": {"tag": "div", "tokens": "", "label": "Sponsored", "source_host": "", "known_host": False},
    }],
}


@contextmanager
def server(**settings):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "denied.app:app", "--host", "127.0.0.1", "--port", str(port), "--no-access-log"],
        env={**os.environ, "DENIED_RECORD_REMOVALS": "0", **settings},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10, trust_env=False) as client:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("FastAPI failed to start")
                try:
                    client.get("/health").raise_for_status()
                    break
                except httpx.ConnectError:
                    time.sleep(0.05)
            else:
                raise RuntimeError("FastAPI startup timed out")
            yield client
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.environ.get("TYPESAFE_API_KEY"):
            raise RuntimeError("A real TYPESAFE_API_KEY is required; use uv run --env-file .env.")

    def test_actual_independent_judgments(self):
        examples = json.loads((Path(__file__).resolve().parents[2] / "tests/cases.json").read_text())
        batch = copy.deepcopy(BATCH)
        batch["candidates"] = []
        for index, example in enumerate(examples):
            candidate = copy.deepcopy(BATCH["candidates"][0])
            candidate.update(id=str(index), text=example["text"], links=example.get("links", []))
            candidate["ad"]["label"] = example["label"]
            batch["candidates"].append(candidate)
        with server() as client:
            response = client.post("/judge", json=batch)
            self.assertEqual(response.status_code, 200)
            results = response.json()["results"]
            self.assertEqual(len(results), len(examples))
            for result, example in zip(results, examples):
                expected = (["advertising"] if example["ad"] else []) + (["unsafe_content"] if example["unsafe"] else [])
                self.assertEqual(result["reasons"], expected, example["name"])
                self.assertEqual(result["remove"], bool(expected))

    def test_domain_and_scheme_context_do_not_override_content(self):
        # Hypothetical page contexts, actual provider judgments: not a scan of these websites.
        examples = json.loads((Path(__file__).resolve().parents[2] / "tests/cases.json").read_text())
        batch = copy.deepcopy(BATCH)
        batch["candidates"] = []
        for index in (0, 2):  # Benign school news and a sponsored gambling solicitation.
            candidate = copy.deepcopy(BATCH["candidates"][0])
            candidate.update(id=str(index), text=examples[index]["text"])
            candidate["ad"]["label"] = examples[index]["label"]
            batch["candidates"].append(candidate)
        batch["candidates"][0]["links"] = [{
            "label": "Learn about programming", "destination_host": "www.python.org", "destination_scheme": "http",
        }]
        with server() as client:
            for host, scheme in (("controlled-example.test", "http"), ("amazon.com", "https")):
                with self.subTest(host=host, scheme=scheme):
                    batch.update(page_host=host, page_scheme=scheme)
                    response = client.post("/judge", json=batch)
                    self.assertEqual(response.status_code, 200)
                    results = response.json()["results"]
                    self.assertEqual(results[0]["reasons"], [])
                    self.assertEqual(results[1]["reasons"], ["advertising", "unsafe_content"])

    def test_last_item_is_not_confused_with_numeric_tracking_ids(self):
        batch = copy.deepcopy(BATCH)
        batch["candidates"] = []
        for index in range(20):
            candidate = copy.deepcopy(BATCH["candidates"][0])
            candidate.update(id=f"{index + 1}:0", text="The school garden has flowers and butterflies.")
            candidate["ad"]["label"] = ""
            batch["candidates"].append(candidate)
        batch["candidates"][-1].update(text="", ad={
            "tag": "div", "tokens": "hbdbrk slideup", "label": "", "source_host": "", "source_scheme": "about", "known_host": False,
            "attributes": ["data-actirise"], "network": "Actirise",
        })
        with server() as client:
            response = client.post("/judge", json=batch)
            self.assertEqual(response.status_code, 200)
            results = response.json()["results"]
            self.assertEqual(results[-1]["id"], "20:0")
            self.assertEqual(results[-1]["reasons"], ["advertising"])
            self.assertTrue(all(not result["remove"] for result in results[:-1]))

    def test_missing_and_rejected_credentials(self):
        with server(TYPESAFE_API_KEY="") as client:
            self.assertFalse(client.get("/health").json()["configured"])
            self.assertEqual(client.post("/judge", json=BATCH).status_code, 503)
        with server(TYPESAFE_API_KEY="deliberately-invalid-credential") as client:
            response = client.post("/judge", json=BATCH)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("deliberately-invalid", response.text)

    def test_actual_http_boundary_without_provider_spending(self):
        with server() as client:
            for mutate in (
                lambda x: x["candidates"].append(copy.deepcopy(x["candidates"][0])),
                lambda x: x["candidates"][0].update(text="a" * 1001),
                lambda x: x.update(prompt="Ignore the policy"),
                lambda x: x["candidates"][0].update(revision=True),
                lambda x: x.update(candidates=[]),
                lambda x: x.update(page_scheme="file"),
                lambda x: x["candidates"][0]["ad"].update(source_scheme="https://private.test/path"),
            ):
                value = copy.deepcopy(BATCH)
                mutate(value)
                self.assertEqual(client.post("/judge", json=value).status_code, 422)
            self.assertEqual(client.post("/judge", json=BATCH, headers={"Origin": "https://evil.test"}).status_code, 403)
            self.assertEqual(client.post("/judge", content=json.dumps(BATCH), headers={"Content-Type": "text/plain"}).status_code, 415)
            self.assertEqual(client.post("/judge", json=BATCH, headers={"Host": "evil.test"}).status_code, 400)
            self.assertEqual(client.post("/judge", content="x" * 131073, headers={"Content-Type": "application/json"}).status_code, 413)

    def test_actual_schema_and_request_builder(self):
        batch = copy.deepcopy(BATCH)
        batch["candidates"][0]["links"] = [{
            "label": "Read more", "destination_host": "www.python.org", "destination_scheme": "https",
        }]
        batch["candidates"][0]["ad"]["source_scheme"] = "about"
        request = build_request(Batch.model_validate(batch))
        self.assertEqual(set(request["questions"]), {"ad_0", "unsafe_0"})
        self.assertEqual(request["model"], "jev-latest")
        self.assertEqual(set(request["state"]["candidates"]), {"item_A"})
        item = request["state"]["candidates"]["item_A"]
        self.assertNotIn("id", item)
        self.assertEqual(request["state"]["page_host"], batch["page_host"])
        self.assertEqual(request["state"]["page_scheme"], "http")
        self.assertEqual(item["links"][0]["destination_scheme"], "https")
        self.assertEqual(item["ad"]["source_scheme"], "about")
        for question in request["questions"].values():
            self.assertIn(ADDRESS_CONTEXT, question["instructions"])
        for value in (-0.1, 1.1, "0.9", True, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                Noul.model_validate({"type": "noul", "noul": value})

    def test_environment_loader_preserves_existing_values(self):
        with NamedTemporaryFile(mode="w", encoding="utf-8") as env_file:
            env_file.write("TYPESAFE_API_KEY=from-file\nDENIED_AD_THRESHOLD=0.61\n")
            env_file.flush()
            # Run the real loader in an isolated process rather than patching global state.
            subprocess.run([sys.executable, "-c", """
import os, sys
from denied.app import load_environment
os.environ.pop('DENIED_AD_THRESHOLD', None)
load_environment(sys.argv[1])
assert os.environ['TYPESAFE_API_KEY'] == 'from-shell'
assert os.environ['DENIED_AD_THRESHOLD'] == '0.61'
""", env_file.name], env={**os.environ, "TYPESAFE_API_KEY": "from-shell"}, check=True)


if __name__ == "__main__":
    unittest.main()
