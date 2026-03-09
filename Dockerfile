FROM node:18.5.0 

WORKDIR /usr/src

COPY ["package.json", "package-lock.json",  "/usr/src/"]

RUN npm install

COPY [".", "/usr/src/"]

EXPOSE 3335

CMD [ "npm", "start" ]
