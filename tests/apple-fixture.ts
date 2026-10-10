// Generated schema examples, not data exported by an Apple device.
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

export const appleWorkout = (attributes = "", children = "", day = "01") =>
  `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" sourceName="Synthetic Runner’s Watch" device="Synthetic private device" startDate="2026-01-${day} 09:00:00 +0900" endDate="2026-01-${day} 09:40:00 +0900" duration="40" durationUnit="min" ${attributes}>${children}</Workout>`;
export const appleDocument = (
  body: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [<!ELEMENT HealthData ANY><!ATTLIST HealthData locale CDATA #IMPLIED>]>
<HealthData locale="ko_KR">
<Me HKCharacteristicTypeIdentifierDateOfBirth="PRIVATE-BIRTHDAY"/>
${body}</HealthData>`;
export const appleXml = () =>
  appleDocument(
    `<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="PRIVATE-NAME" value="999" unit="count/min" startDate="2026-01-01 09:01:00 +0900" endDate="2026-01-01 09:01:00 +0900"/>
  ${appleWorkout('totalDistance="5" totalDistanceUnit="km"')}
  ${appleWorkout("", '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="6" unit="km"/><WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="145" maximum="166" unit="count/min"/>', "03")}
  <Workout workoutActivityType="HKWorkoutActivityTypeWalking" sourceName="Synthetic" startDate="2026-01-04 09:00:00 +0900" endDate="2026-01-04 09:40:00 +0900" duration="40" durationUnit="min"/>`,
  );
export async function appleZip(xml = appleXml()) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  await writer.add("apple_health_export/export.xml", new TextReader(xml));
  await writer.add(
    "apple_health_export/export_cda.xml",
    new TextReader("not a supported source"),
  );
  await writer.add(
    "apple_health_export/workout-routes/route.gpx",
    new TextReader("PRIVATE-GPS"),
  );
  return writer.close();
}
