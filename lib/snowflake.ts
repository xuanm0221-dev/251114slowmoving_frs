import snowflake from "snowflake-sdk";

export function runQuery(sql: string): Promise<any[]> {
  const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT as string,
    username: process.env.SNOWFLAKE_USERNAME as string,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: privateKey as string,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE as string,
    database: process.env.SNOWFLAKE_DATABASE as string,
    schema: process.env.SNOWFLAKE_SCHEMA as string,
    role: process.env.SNOWFLAKE_ROLE as string
  });

  return new Promise<any[]>((resolve, reject) => {
    connection.connect(err => {
      if (err) {
        reject(err);
        return;
      }

      connection.execute({
        sqlText: sql,
        complete: (err, _stmt, rows: any) => {
          if (err) {
            reject(err);
            return;
          }
          // rows 타입을 any[] 로 강제
          resolve(rows as any[]);
        }
      });
    });
  });
}
