import unittest

from denied.dispatch import Admission


class AdmissionTests(unittest.TestCase):
    def test_second_wave_fits_but_third_waits_for_minute_window(self):
        gate = Admission()
        gate.starts.extend(0.0 for _ in range(600))
        self.assertEqual(gate.delay(5), 0)
        gate.starts.extend(5.0 for _ in range(600))
        self.assertEqual(gate.delay(10), 50)
        self.assertEqual(gate.delay(60), 0)

    def test_json_size_does_not_serialize_a_thirty_request_wave(self):
        gate = Admission()
        for _ in range(30):
            self.assertEqual(gate.delay(0), 0)
            gate.starts.append(0.0)
