const { createClient } = require('@supabase/supabase-js');

// Configuration from services/supabase.ts
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

console.log('🔍 Диагностика подключения к Supabase...');
console.log('URL:', SUPABASE_URL);
console.log('Key:', SUPABASE_ANON_KEY.substring(0, 20) + '...');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testConnection() {
  try {
    console.log('\n1. Тест подключения к таблице jobs...');
    const { data, error } = await supabase.from('jobs').select('count').limit(1).single();
    if (error) {
      console.error('❌ Ошибка jobs:', error);
    } else {
      console.log('✅ Таблица jobs доступна, записей:', data);
    }

    console.log('\n2. Тест подключения к таблице cv_profiles...');
    const { data: profiles, error: profileError } = await supabase.from('cv_profiles').select('id').limit(1);
    if (profileError) {
      console.error('❌ Ошибка cv_profiles:', profileError);
    } else {
      console.log('✅ Таблиця cv_profiles доступна, записей:', profiles.length);
    }

    console.log('\n3. Тест подключения к таблице applications...');
    const { data: apps, error: appError } = await supabase.from('applications').select('id').limit(1);
    if (appError) {
      console.error('❌ Ошибка applications:', appError);
    } else {
      console.log('✅ Таблица applications доступна, записей:', apps.length);
    }

    console.log('\n4. Тест подключения к таблице user_settings...');
    const { data: settings, error: settingsError } = await supabase.from('user_settings').select('id').limit(1);
    if (settingsError) {
      console.error('❌ Ошибка user_settings:', settingsError);
    } else {
      console.log('✅ Таблица user_settings доступна, записей:', settings.length);
    }

    console.log('\n5. Тест аутентификации...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.log('ℹ️ Пользователь не авторизован (это нормально):', authError.message);
    } else {
      console.log('✅ Пользователь авторизован:', user?.id);
    }

  } catch (err) {
    console.error('❌ Критическая ошибка:', err);
  }
}

testConnection();