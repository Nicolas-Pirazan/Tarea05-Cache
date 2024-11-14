    const express = require('express');
    const app = express();
    const mysql = require('mysql2/promise');
    const cors = require('cors');
    const redis = require('redis');

    app.use(cors());

    // Configurar el middleware para que Express reconozca los datos JSON en las solicitudes
    app.use(express.json());

    const db = mysql.createPool({
        host: 'localhost',
        user: 'root',
        password: 'a123',
        database: 'distribuidos'
    });

    const client = redis.createClient({
        socket: {
            host: 'localhost',
            port: 6379
        }
    });

    client.on('error', (err) => console.error('Redis Client Error', err));

    async function initRedis() {
        try {
            await client.connect(); // Espera la conexión
        } catch (error) {
            console.error('Error al inicializar Redis:', error);
            throw error;
        }
    }

    initRedis();

    app.use(cors());

    async function updateCache(key, value) {
        try {
            const accessCountKey = `accessCount:${key}`;
            let currentCount = await client.get(accessCountKey);
            
            // Si no hay un contador, inicialízalo a 1
            if (!currentCount) {
                currentCount = 1;
                await client.set(accessCountKey, currentCount);
            } else {
                currentCount = await client.incr(accessCountKey); // Incrementamos el contador
            }
    
            // Recuperamos la caché de consultas recientes
            let cachedData = JSON.parse(await client.get('recentAccess')) || [];
    
            // Comprobamos si la consulta ya está en la caché
            const existingIndex = cachedData.findIndex(entry => entry.key === key);
            
            if (existingIndex !== -1) {
                // Si ya existe, actualizamos su contador y metadata
                cachedData[existingIndex].accessCount = currentCount;
                cachedData[existingIndex].value = value; // Actualizamos los metadatos
            } else {
                // Si no existe, agregamos la nueva consulta
                    if (cachedData.length >= 5) {
                        // console.log('Cache is full, removing least accessed entry');
                        // // Si ya hay 5 consultas, eliminamos la de menor acceso
                        // cachedData.sort((a, b) => a.accessCount - b.accessCount);
                        // cachedData.shift();
                        console.log('Cache is full, removing least accessed entry');
                        // Encontrar el índice del elemento con el menor acceso
                        let minIndex = 0;
                        for (let i = 1; i < cachedData.length; i++) {
                            if (cachedData[i].accessCount < cachedData[minIndex].accessCount) {
                                minIndex = i;
                            }
                        }

                        // Eliminar la consulta con el menor acceso
                        cachedData.splice(minIndex, 1);
                    }
                cachedData.push({ key, value, accessCount: currentCount });
            }
            console.log('len:', cachedData.length);
            
            // Guardamos la caché actualizada en Redis
            await client.set('recentAccess', JSON.stringify(cachedData));
        } catch (error) {
            console.error('Error al actualizar la caché:', error);
        }
    }
    

    // Endpoint para obtener una consulta específica y actualizar la caché
    app.get('/consulta/:id', async (req, res) => {
        try {
            const id = req.params.id;
            
            // Obtener los datos de la consulta
            const [rows] = await db.query('SELECT * FROM prueba WHERE idprueba = ?', [id]);
            
            if (rows.length > 0) {
                const data = rows[0];
                
                await updateCache(id, data);
                
                return res.json(data);
            } else {
                return res.status(404).json({ error: 'No encontrado' });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });

    // Endpoint para obtener las 5 consultas más populares
    app.get('/consultas-populares', async (req, res) => {
        try {
            // Obtener los datos de la clave 'recentAccess' como un JSON string
            const result = await client.get('recentAccess');
            
            // Parsear el JSON para convertirlo en un objeto JavaScript
            const consultas = JSON.parse(result);

            // Formatear y filtrar los resultados para eliminar duplicados
            const resultados = [];
            const idsUnicos = new Set();

            consultas.forEach(consulta => {
                if (!idsUnicos.has(consulta.key)) {
                    resultados.push({
                        id: consulta.key,
                        contador: consulta.accessCount,
                        metadata: consulta.value
                    });
                    idsUnicos.add(consulta.key); // Agregar el ID al conjunto de IDs únicos
                }
            });

            res.json(resultados);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });


    app.listen(3000, () => {
        console.log('Server is running on port 3000');
    });