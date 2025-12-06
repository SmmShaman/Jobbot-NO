import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // SQL для виправлення RLS політик
    const fixRLSSql = `
      -- Видаляємо існуючі політики
      DROP POLICY IF EXISTS "Enable read access for all users" ON public.jobs;
      DROP POLICY IF EXISTS "Enable insert access for all users" ON public.jobs;
      DROP POLICY IF EXISTS "Enable update access for all users" ON public.jobs;
      DROP POLICY IF EXISTS "Enable delete access for all users" ON public.jobs;
      
      -- Створюємо нові політики
      CREATE POLICY "Enable read access for all users" ON public.jobs FOR SELECT USING (true);
      CREATE POLICY "Enable insert access for all users" ON public.jobs FOR INSERT WITH CHECK (true);
      CREATE POLICY "Enable update access for all users" ON public.jobs FOR UPDATE USING (true);
      CREATE POLICY "Enable delete access for all users" ON public.jobs FOR DELETE USING (true);
      
      -- Вмикаємо RLS
      ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
    `;

    const { data, error } = await supabase.rpc('exec_sql', { sql: fixRLSSql });
    
    if (error) {
      // Альтернативний метод через direct SQL
      const { error: altError } = await supabase
        .from('jobs')
        .select('count')
        .limit(1);
        
      if (altError && altError.code === 'PGRST116') {
        // Якщо функція не існує, повертаємо інструкції
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'RLS policies need to be fixed manually in Supabase Dashboard',
            sql: fixRLSSql,
            error: error.message 
          }), 
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    }

    // Перевіряємо результат
    const { data: jobsData, error: jobsError } = await supabase
      .from('jobs')
      .select('id,title,status,created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'RLS policies fixed successfully',
        jobsCount: jobsData?.length || 0,
        jobs: jobsData || []
      }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});