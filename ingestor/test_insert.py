import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(url, key)

def test_insert():
    data = {
        "date": "2026-07-29T12:00:00Z",
        "type": "income",
        "category": "Prueba",
        "amount": 100.00,
        "description": "Registro de prueba Bloque A",
        "source_file": "test_insert.py"
    }

    response = supabase.table("financial_records").insert(data).execute()
    print("Resultado de inserción:", response)

if __name__ == "__main__":
    test_insert()