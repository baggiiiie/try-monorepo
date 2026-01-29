#!/usr/bin/env python3
"""Debug script to test Spliit API connectivity."""

import asyncio
import json
import os
import sys
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

load_dotenv()

SPLIIT_BASE_URL = os.getenv("SPLIIT_BASE_URL", "https://spliit.app")
SPLIIT_GROUP_ID = os.getenv("SPLIIT_GROUP_ID", "")


async def test_api():
    """Test various API endpoints."""
    if not SPLIIT_GROUP_ID:
        print("ERROR: SPLIIT_GROUP_ID not set in .env file")
        sys.exit(1)

    print(f"Testing Spliit API at: {SPLIIT_BASE_URL}")
    print(f"Group ID: {SPLIIT_GROUP_ID}")
    print("-" * 50)

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        # Test 1: Health check
        print("\n1. Testing health endpoint...")
        try:
            resp = await client.get(f"{SPLIIT_BASE_URL}/api/health")
            print(f"   Status: {resp.status_code}")
            print(f"   Response: {resp.text[:200]}")
        except Exception as e:
            print(f"   Error: {e}")

        # Test 2: Try to access the group page directly (to see if it exists)
        print("\n2. Testing group page access...")
        try:
            resp = await client.get(f"{SPLIIT_BASE_URL}/groups/{SPLIIT_GROUP_ID}")
            print(f"   Status: {resp.status_code}")
            print(f"   Content length: {len(resp.text)} chars")
            if resp.status_code == 200:
                print("   Group page is accessible!")
        except Exception as e:
            print(f"   Error: {e}")

        # Test 3: Try tRPC groups.get endpoint
        print("\n3. Testing tRPC groups.get endpoint...")
        input_json = json.dumps({"json": {"groupId": SPLIIT_GROUP_ID}})
        try:
            url = f"{SPLIIT_BASE_URL}/api/trpc/groups.get"
            params = {"input": input_json}
            print(f"   URL: {url}")
            print(f"   Params: {params}")

            resp = await client.get(url, params=params)
            print(f"   Status: {resp.status_code}")
            print(f"   Headers: {dict(resp.headers)}")
            print(f"   Response: {resp.text[:500]}")

            if resp.status_code == 200:
                data = resp.json()
                print(f"\n   Parsed JSON keys: {list(data.keys())}")
                if "result" in data:
                    print(f"   Result keys: {list(data['result'].keys())}")
                    if "data" in data["result"]:
                        print(f"   Data keys: {list(data['result']['data'].keys())}")
        except Exception as e:
            print(f"   Error: {e}")

        # Test 4: Try alternative endpoint format
        print("\n4. Testing alternative tRPC format (batch mode)...")
        try:
            url = f"{SPLIIT_BASE_URL}/api/trpc/groups.get"
            params = {"batch": "1", "input": json.dumps({"0": {"json": {"groupId": SPLIIT_GROUP_ID}}})}
            print(f"   URL: {url}")
            print(f"   Params: {params}")

            resp = await client.get(url, params=params)
            print(f"   Status: {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
        except Exception as e:
            print(f"   Error: {e}")

        # Test 5: Check if group details page loads data
        print("\n5. Testing group details API endpoint...")
        try:
            url = f"{SPLIIT_BASE_URL}/api/trpc/groups.getDetails"
            params = {"input": input_json}
            resp = await client.get(url, params=params)
            print(f"   Status: {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
        except Exception as e:
            print(f"   Error: {e}")

        # Test 6: Test balances endpoint
        print("\n6. Testing balances endpoint...")
        try:
            url = f"{SPLIIT_BASE_URL}/api/trpc/groups.balances.list"
            params = {"input": input_json}
            resp = await client.get(url, params=params)
            print(f"   Status: {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
        except Exception as e:
            print(f"   Error: {e}")


if __name__ == "__main__":
    asyncio.run(test_api())
