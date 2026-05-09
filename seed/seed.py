import json
import os
import sys
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT_PATH = os.path.join(SCRIPT_DIR, "service-account.json")
FAKE_DATA_PATH = os.path.join(SCRIPT_DIR, "fake_data.json")
INTERNAL_DOMAIN = "interhack.bcn"

if not os.path.exists(SERVICE_ACCOUNT_PATH):
    print("ERROR: seed/service-account.json not found.")
    print("Download it from: Firebase Console → Project Settings → Service Accounts → Generate new private key")
    sys.exit(1)

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

with open(FAKE_DATA_PATH) as f:
    data = json.load(f)

for driver in data["drivers"]:
    driver_id = driver["id"]
    email = f"{driver_id}@{INTERNAL_DOMAIN}"

    try:
        fb_auth.create_user(email=email, password=driver["password"])
        print(f"  [auth] Created account: {email}")
    except firebase_admin.exceptions.AlreadyExistsError:
        print(f"  [auth] Already exists:  {email}")

    db.collection("routes").document(driver_id).set({
        "driver_id": driver_id,
        "truck_id": driver["truck_id"],
        "points": driver["points"],
        "windows": driver["windows"],
        "service_times": driver["service_times"],
        "delivery_status": ["pending"] * len(driver["points"]),
        "status": "pending",
    })
    print(f"  [db]   Route written for {driver_id}  ({len(driver['points'])} stops)")

ADMIN_EMAIL = f"admin@{INTERNAL_DOMAIN}"
ADMIN_PASSWORD = "dammadmin2026"
try:
    fb_auth.create_user(email=ADMIN_EMAIL, password=ADMIN_PASSWORD)
    print(f"  [auth] Created admin account")
except firebase_admin.exceptions.AlreadyExistsError:
    print(f"  [auth] Admin account already exists")
print(f"  Admin login → id: admin   password: {ADMIN_PASSWORD}")

print("\nDone.")
