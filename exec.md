# Очистка кэша (рекомендуется, но не обязательно)
docker builder prune -a -f
docker image prune -a -f

# Пересборка и запуск
docker compose up -d --build