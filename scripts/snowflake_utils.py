"""
Snowflake 연결 및 쿼리 실행 유틸리티

환경변수 설정 필요:
- SNOWFLAKE_ACCOUNT
- SNOWFLAKE_USER
- SNOWFLAKE_PASSWORD
- SNOWFLAKE_WAREHOUSE
- SNOWFLAKE_DATABASE
- SNOWFLAKE_SCHEMA
- SNOWFLAKE_ROLE
"""

import snowflake.connector
import os
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

# .env 파일 로드 (프로젝트 루트에서)
env_path = Path(__file__).parent.parent / '.env.local'
if env_path.exists():
    load_dotenv(env_path)
else:
    print(f"[WARNING] .env.local 파일을 찾을 수 없습니다: {env_path}")


def get_snowflake_connection() -> snowflake.connector.SnowflakeConnection:
    """
    Snowflake 연결 생성
    
    Returns:
        snowflake.connector.SnowflakeConnection: Snowflake 연결 객체
    
    Raises:
        ValueError: 필수 환경변수가 없을 경우
    """
    required_env_vars = [
        'SNOWFLAKE_ACCOUNT',
        'SNOWFLAKE_USER',
        'SNOWFLAKE_PASSWORD',
        'SNOWFLAKE_WAREHOUSE',
        'SNOWFLAKE_DATABASE',
        'SNOWFLAKE_SCHEMA'
    ]
    
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    if missing_vars:
        raise ValueError(f"필수 환경변수가 설정되지 않았습니다: {', '.join(missing_vars)}")
    
    try:
        conn = snowflake.connector.connect(
            account=os.getenv('SNOWFLAKE_ACCOUNT'),
            user=os.getenv('SNOWFLAKE_USER'),
            password=os.getenv('SNOWFLAKE_PASSWORD'),
            warehouse=os.getenv('SNOWFLAKE_WAREHOUSE'),
            database=os.getenv('SNOWFLAKE_DATABASE'),
            schema=os.getenv('SNOWFLAKE_SCHEMA'),
            role=os.getenv('SNOWFLAKE_ROLE', 'PUBLIC')  # role은 선택적
        )
        return conn
    except Exception as e:
        raise ConnectionError(f"Snowflake 연결 실패: {e}")


def execute_query(query: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Snowflake 쿼리 실행 및 결과 반환
    
    Args:
        query: 실행할 SQL 쿼리
        params: 쿼리 파라미터 (선택적)
    
    Returns:
        List[Dict[str, Any]]: 쿼리 결과 (딕셔너리 리스트)
    
    Example:
        results = execute_query("SELECT * FROM table WHERE id = %(id)s", {'id': 123})
    """
    conn = None
    try:
        conn = get_snowflake_connection()
        cursor = conn.cursor(snowflake.connector.DictCursor)
        
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        
        results = cursor.fetchall()
        cursor.close()
        
        return results
    
    except Exception as e:
        print(f"[ERROR] 쿼리 실행 실패:")
        print(f"  쿼리: {query[:200]}...")
        print(f"  에러: {e}")
        raise
    
    finally:
        if conn:
            conn.close()


def execute_query_batch(query: str, batch_size: int = 10000) -> List[Dict[str, Any]]:
    """
    대용량 쿼리를 배치로 실행하여 메모리 효율적으로 처리
    
    Args:
        query: 실행할 SQL 쿼리
        batch_size: 한 번에 가져올 행 수
    
    Returns:
        List[Dict[str, Any]]: 전체 쿼리 결과
    """
    conn = None
    all_results = []
    
    try:
        conn = get_snowflake_connection()
        cursor = conn.cursor(snowflake.connector.DictCursor)
        cursor.execute(query)
        
        while True:
            batch = cursor.fetchmany(batch_size)
            if not batch:
                break
            all_results.extend(batch)
            print(f"  배치 로드: {len(all_results):,}행...")
        
        cursor.close()
        return all_results
    
    except Exception as e:
        print(f"[ERROR] 배치 쿼리 실행 실패: {e}")
        raise
    
    finally:
        if conn:
            conn.close()


def test_connection() -> bool:
    """
    Snowflake 연결 테스트
    
    Returns:
        bool: 연결 성공 여부
    """
    try:
        result = execute_query("SELECT CURRENT_VERSION() AS version, CURRENT_DATABASE() AS db, CURRENT_SCHEMA() AS schema")
        if result:
            print(f"[SUCCESS] Snowflake 연결 성공:")
            print(f"  Version: {result[0].get('VERSION')}")
            print(f"  Database: {result[0].get('DB')}")
            print(f"  Schema: {result[0].get('SCHEMA')}")
            return True
        return False
    except Exception as e:
        print(f"[FAIL] Snowflake 연결 실패: {e}")
        return False


if __name__ == "__main__":
    # 연결 테스트
    print("=" * 60)
    print("Snowflake 연결 테스트")
    print("=" * 60)
    test_connection()


