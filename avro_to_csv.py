import os
import csv
from fastavro import reader


def avro_to_csv_folder(input_base_path, output_base_path):
    for root, _, files in os.walk(input_base_path):
        for file in files:
            if file.endswith(".avro"):
                avro_path = os.path.join(root, file)

                relative_folder = os.path.relpath(root, input_base_path)
                output_folder = os.path.join(output_base_path, relative_folder)
                os.makedirs(output_folder, exist_ok=True)

                csv_filename = os.path.splitext(file)[0] + ".csv"
                csv_path = os.path.join(output_folder, csv_filename)

                convert_avro_to_csv(avro_path, csv_path)
                print(f"Converted: {avro_path} → {csv_path}")


def convert_avro_to_csv(avro_file_path, csv_file_path):
    with open(avro_file_path, 'rb') as avro_file:
        avro_reader = reader(avro_file)
        records = list(avro_reader)

        if not records:
            print(f"No records in: {avro_file_path}")
            return

        fieldnames = records[0].keys()

        with open(csv_file_path, 'w', newline='') as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(records)


input_dir = "/Users/sunnysun/Desktop/ambient_intelligence/1/Empatica_raw_data/participant_data"
output_dir = "/Users/sunnysun/Desktop/ambient_intelligence/1/Empatica_raw_data/participant_data_csv"
avro_to_csv_folder(input_dir, output_dir)
