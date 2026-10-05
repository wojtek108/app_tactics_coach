"""
Run this locally with your key as an environment variable:
    export ZAI_API_KEY="your-key-here"
    python3 test_zai_connection.py

Never paste the key itself anywhere -- just report back what this prints.
"""
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.environ["ZAI_API_KEY"],
    base_url="https://api.z.ai/api/coding/paas/v4/",
)

response = client.chat.completions.create(
    model="glm-4.7",
    max_tokens=100,
    messages=[{"role": "user", "content": "Reply with exactly: connection works"}],
)

print(response.choices[0].message.content)
